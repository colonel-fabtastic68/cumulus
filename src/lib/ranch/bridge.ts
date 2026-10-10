import type { Integration, Lot, MovementType, OrderBridge, PackListing, SalesOrder, StockMovement } from "@/lib/types";
import { activityOp, createOrder, itemDefaults, movementOps, nextNumbers, shipOrder, type MovementInput } from "@/lib/inventory";
import type { WriteOp } from "@/lib/store/types";
import { hasFeature } from "@/lib/instances";
import { newId, nowIso, round } from "@/lib/utils";
import { HttpError, readSecrets, type Secrets, type ServerContext } from "@/lib/integrations/server";
import { wooCreds } from "@/lib/integrations/channelSync";
import * as square from "@/lib/integrations/square";
import * as woo from "@/lib/integrations/woocommerce";
import { describePlan, planMirror, unitForSquare, type MirrorPlan, type SquareCatalogRow } from "./squareMirror";
import { expandOrder, listingsUsing, packsAvailable, type StoreLine } from "./packs";
import { OUR_REFERENCE, describeSquareSync, planCountPush, planNewVariations, planSquareImport, ranchModeOf, readSquareHistory, variationPrecision, type ImportPlan, type RanchMode } from "./squareTruth";

/**
 * The ranch bridge. Square's "Lot #" variations are animals' shares of each
 * cut, cumulusOS tracks them as lots, and the web store sells packs computed
 * from those pounds. Who holds the counts depends on the mode (squareTruth.ts):
 *
 * "square" (route A): Square is the record and cumulusOS mirrors it.
 *   Square counts  ──mirror──▶ cumulusOS lots ──packs──▶ WooCommerce stock + price
 *   WooCommerce order paid ──▶ cumulusOS sale (oldest lot first) ──▶ Square IN_STOCK → SOLD per lot
 *
 * "cumulus": cumulusOS is the record and sets Square's counts.
 *   animals received / recounted here ──▶ Square counts (new animals become Lot # variations)
 *   Square counter sales and refunds ──history──▶ cumulusOS sales and returns on the same lot
 *   anything else changed in Square ──▶ reported, then put back
 *   WooCommerce order paid ──▶ cumulusOS sale (oldest lot first) ──▶ Square counts
 *
 * Payments never pass through here: the store's own Square gateway takes them.
 */

export const BRIDGE_ACTOR = { id: "ranch-bridge", name: "Ranch bridge" };

export function isRanch(ctx: Pick<ServerContext, "instance">): boolean {
  return hasFeature(ctx.instance, "ranch");
}

export function requireRanch(ctx: Pick<ServerContext, "instance">): void {
  if (!isRanch(ctx)) throw new HttpError(404, "Not available here.");
}

/** Who holds the counts: Square (route A, the default) or cumulusOS. */
export function ranchMode(integration: Pick<Integration, "config"> | null | undefined): RanchMode {
  return ranchModeOf(integration?.config);
}

async function connected(ctx: ServerContext, id: "square" | "woocommerce"): Promise<{ integration: Integration; secrets: Secrets } | null> {
  const integration = await ctx.store.get("integrations", id);
  if (!integration || integration.status === "not_connected") return null;
  const secrets = await readSecrets(ctx, id);
  return secrets ? { integration, secrets } : null;
}

/** The Square location the ranch counts and sells from. */
export function squareLocationId(integration: Integration): string {
  const configured = integration.config?.ranchLocationId?.trim();
  if (configured) return configured;
  const first = (integration.config?.locationIds ?? "").split(",").map((s) => s.trim()).find(Boolean);
  if (!first) throw new HttpError(409, "Square has no active location to count from. Reconnect Square.");
  return first;
}

/** Flattens Square catalog objects into the rows the mirror plans from. */
export function catalogRows(objects: square.SquareCatalogObject[]): SquareCatalogRow[] {
  const units = new Map(objects.filter((o) => o.type === "MEASUREMENT_UNIT").map((o) => [o.id, o.measurement_unit_data?.measurement_unit?.weight_unit]));
  const rows: SquareCatalogRow[] = [];
  for (const o of objects) {
    if (o.type !== "ITEM" || o.is_deleted || !o.item_data) continue;
    for (const v of o.item_data.variations ?? []) {
      if (v.is_deleted) continue;
      const d = v.item_variation_data ?? {};
      rows.push({
        squareItemId: o.id,
        itemName: o.item_data.name ?? o.id,
        variationId: v.id,
        variationName: d.name ?? "",
        sku: d.sku,
        priceCents: typeof d.price_money?.amount === "number" ? d.price_money.amount : undefined,
        unit: unitForSquare(d.measurement_unit_id ? units.get(d.measurement_unit_id) : undefined),
        createdAt: v.created_at ?? o.created_at,
        trackInventory: d.track_inventory !== false,
      });
    }
  }
  return rows;
}

// ---- Square → cumulusOS -------------------------------------------------------------

/**
 * Pounds per Square variation that cumulusOS has already taken (web sales) or
 * put back (cancelled web orders) without Square being told yet. The mirror
 * subtracts these so an outstanding push is not undone.
 */
export async function pendingSquare(ctx: ServerContext): Promise<Map<string, number>> {
  const orders = (await ctx.store.list("orders")).filter((o) => o.bridge && (isOutstanding(o.bridge.square) || (o.bridge.reversed && isOutstanding(o.bridge.reversed.square))));
  const out = new Map<string, number>();
  if (orders.length === 0) return out;
  const lots = new Map((await ctx.store.list("lots")).map((l) => [l.id, l]));
  const movements = await ctx.store.list("movements");
  for (const order of orders) {
    const mine = movements.filter((m) => m.refType === "order" && m.refId === order.id);
    if (isOutstanding(order.bridge!.square)) {
      for (const a of saleAllocations(mine)) {
        const v = lots.get(a.lotId)?.externalIds?.square;
        if (v) out.set(v, round((out.get(v) ?? 0) + a.qty, 3));
      }
    }
    if (order.bridge!.reversed && isOutstanding(order.bridge!.reversed.square)) {
      for (const m of mine.filter((x) => x.type === "rma_return" && x.lotId)) {
        const v = lots.get(m.lotId!)?.externalIds?.square;
        if (v) out.set(v, round((out.get(v) ?? 0) - m.qty, 3));
      }
    }
  }
  return out;
}

function isOutstanding(p: { status: string } | undefined): boolean {
  return !!p && (p.status === "pending" || p.status === "failed");
}

function saleAllocations(movements: StockMovement[]): Array<{ lotId: string; qty: number }> {
  return movements.filter((m) => m.type === "sale").flatMap((m) => m.lots ?? []);
}

export interface MirrorResult {
  summary: string;
  /** Items whose stock changed, so their packs can be re-pushed. */
  itemIds: string[];
  negatives: number;
}

/** Writes a mirror plan: new cuts, then new lots and count changes through the ledger. Returns the items whose stock changed. */
async function applyMirrorPlan(ctx: ServerContext, plan: MirrorPlan, now: string, message: string): Promise<string[]> {
  // 1. Cuts first, so the movements below can find them.
  const created = new Map<string, string>();
  const itemOps: WriteOp[] = [];
  for (const ni of plan.newItems) {
    const item = itemDefaults({ sku: ni.sku, name: ni.name, unit: ni.unit, price: ni.price, externalIds: { square: ni.squareItemId }, category: "Cuts" });
    created.set(ni.squareItemId, item.id);
    itemOps.push({ op: "put", collection: "items", doc: item });
  }
  for (const p of plan.itemPatches) itemOps.push({ op: "patch", collection: "items", id: p.itemId, patch: { ...p.patch, updatedAt: now } });
  if (itemOps.length) await ctx.store.batch(itemOps);

  // 2. Lots and their quantities, through the ledger.
  const inputs: MovementInput[] = [];
  const lotDocs: Lot[] = [];
  const lotPatches: WriteOp[] = [];
  const touched = new Set<string>();
  const { numbers, ops: numberOps } = plan.newLots.length ? await nextNumbers(ctx.store, { lot: plan.newLots.length }) : { numbers: { lot: [] as string[] }, ops: [] as WriteOp[] };
  plan.newLots.forEach((nl, i) => {
    const itemId = nl.itemId ?? created.get(nl.squareItemId);
    if (!itemId) return;
    const lot: Lot = { id: newId("lot"), number: numbers.lot[i], itemId, supplierLot: nl.label, source: "import", qtyReceived: nl.qty, qtyRemaining: nl.qty, unitCost: 0, receivedAt: nl.receivedAt, externalIds: { square: nl.variationId } };
    lotDocs.push(lot);
    inputs.push({ itemId, type: "count", qty: nl.qty, lotId: lot.id, refType: "channel", reason: "Square count", note: nl.label, occurredAt: now });
    touched.add(itemId);
  });
  const lotsById = new Map((plan.changes.length ? await ctx.store.list("lots") : []).map((l) => [l.id, l]));
  for (const c of plan.changes) {
    const delta = round(c.to - c.from, 3);
    if (delta === 0) continue;
    touched.add(c.itemId);
    if (delta > 0) {
      const lot = lotsById.get(c.lotId)!;
      inputs.push({ itemId: c.itemId, type: "count", qty: delta, lotId: c.lotId, refType: "channel", reason: "Square count", note: c.label, occurredAt: now });
      lotPatches.push({ op: "patch", collection: "lots", id: c.lotId, patch: { qtyRemaining: round(lot.qtyRemaining + delta, 3), qtyReceived: round(lot.qtyReceived + delta, 3) } });
    } else {
      inputs.push({ itemId: c.itemId, type: "count", qty: delta, fromLotIds: [c.lotId], refType: "channel", reason: "Square count", note: c.label, occurredAt: now });
    }
  }
  if (inputs.length || lotDocs.length) {
    // New lots must exist before movementOps reads lots for the allocations; they only ever receive here.
    const mv = await movementOps(ctx.store, BRIDGE_ACTOR, inputs, { allowNegative: true });
    await ctx.store.batch([
      ...numberOps,
      ...lotDocs.map<WriteOp>((doc) => ({ op: "put", collection: "lots", doc })),
      ...mv.ops,
      ...lotPatches,
      activityOp(BRIDGE_ACTOR, "integration.synced", message, { entityType: "integration", entityId: "square" }),
    ]);
  }
  return Array.from(touched);
}

/** Brings cumulusOS lots in line with Square's counts (all of them, or just the variations a webhook named). */
export async function runSquareMirror(ctx: ServerContext, opts: { variationIds?: string[] } = {}): Promise<MirrorResult> {
  const conn = await connected(ctx, "square");
  if (!conn) return { summary: "Square is not connected", itemIds: [], negatives: 0 };
  const { integration, secrets } = conn;
  // With cumulusOS holding the counts, Square's numbers never overwrite lots here.
  if (ranchMode(integration) === "cumulus") return { summary: "cumulusOS holds the counts", itemIds: [], negatives: 0 };
  const locationId = squareLocationId(integration);
  const { rows, counts } = await square.withSquareToken(ctx, secrets, async (token, env) => {
    const objects = await square.listCatalogObjects(env, token, ["ITEM", "MEASUREMENT_UNIT"]);
    const all = catalogRows(objects);
    const wanted = opts.variationIds ? new Set(opts.variationIds) : null;
    const ids = all.filter((r) => r.unit !== "ea" && r.trackInventory && (!wanted || wanted.has(r.variationId))).map((r) => r.variationId);
    return { rows: all, counts: ids.length ? await square.inventoryCounts(env, token, ids, [locationId]) : new Map<string, number>() };
  });
  const now = nowIso();
  const [items, lots, pending] = await Promise.all([ctx.store.list("items"), ctx.store.list("lots"), pendingSquare(ctx)]);
  const plan = planMirror({ rows, counts, items, lots, pending, excludedSkus: new Set((integration.excludedSkus ?? []).map((s) => s.toUpperCase())), onlyVariationIds: opts.variationIds ? new Set(opts.variationIds) : undefined, now });

  const summary = describePlan(plan);
  const touched = await applyMirrorPlan(ctx, plan, now, `Square counts: ${summary}`);
  await ctx.store.patch("integrations", "square", { status: "connected", lastSyncAt: now, lastSyncSummary: summary, lastError: undefined });
  return { summary, itemIds: touched, negatives: plan.negatives.length };
}

// ---- cumulusOS → Square ----------------------------------------------------------------

/** Tells Square about a recorded web sale (or its reversal) lot by lot. Safe to repeat: the idempotency key is fixed per order and kind. */
export async function pushSquareForOrder(ctx: ServerContext, orderId: string, kind: "sale" | "return"): Promise<OrderBridge["square"]> {
  const order = await ctx.store.get("orders", orderId);
  if (!order?.bridge) throw new HttpError(404, "Not a bridged order.");
  const conn = await connected(ctx, "square");
  const set = async (state: OrderBridge["square"]) => {
    const bridge: OrderBridge = kind === "sale" ? { ...order.bridge!, square: state } : { ...order.bridge!, reversed: { at: order.bridge!.reversed?.at ?? nowIso(), square: state } };
    await ctx.store.patch("orders", order.id, { bridge });
    return state;
  };
  if (!conn) return set({ status: "failed", error: "Square is not connected", at: nowIso() });
  const lots = new Map((await ctx.store.list("lots")).map((l) => [l.id, l]));
  const mine = (await ctx.store.list("movements")).filter((m) => m.refType === "order" && m.refId === order.id);
  const locationId = squareLocationId(conn.integration);
  const ref = `${OUR_REFERENCE}: web order ${order.externalRef ?? order.number}`;
  const occurredAt = nowIso();
  const pairs = kind === "sale" ? saleAllocations(mine) : mine.filter((m) => m.type === "rma_return" && m.lotId).map((m) => ({ lotId: m.lotId!, qty: m.qty }));
  if (ranchMode(conn.integration) === "cumulus") {
    // cumulusOS holds the counts: Square is set to what these lots now hold, which is safe to repeat.
    try {
      const r = await syncSquareFromCumulus(ctx, { lotIds: Array.from(new Set(pairs.map((p) => p.lotId))), reason: kind === "sale" ? `${ref} sold` : `${ref} put back` });
      return set({ status: "pushed", adjustments: r.counts, at: occurredAt, error: r.problems[0] });
    } catch (e) {
      return set({ status: "failed", error: e instanceof Error ? e.message : String(e), at: occurredAt });
    }
  }
  const byVariation = new Map<string, number>();
  let unlinked = 0;
  for (const p of pairs) {
    const v = lots.get(p.lotId)?.externalIds?.square;
    if (!v) {
      unlinked++;
      continue;
    }
    byVariation.set(v, round((byVariation.get(v) ?? 0) + p.qty, 5));
  }
  const adjustments: square.SquareAdjustment[] = Array.from(byVariation.entries())
    .filter(([, qty]) => qty > 0)
    .map(([variationId, quantity]) => ({ variationId, locationId, quantity, fromState: kind === "sale" ? "IN_STOCK" : "NONE", toState: kind === "sale" ? "SOLD" : "IN_STOCK", occurredAt, referenceId: ref }));
  if (adjustments.length === 0) return set({ status: "skipped", adjustments: 0, error: unlinked ? `${unlinked} lot(s) are not linked to Square` : undefined, at: occurredAt });
  try {
    await square.withSquareToken(ctx, conn.secrets, (token, env) => square.batchChangeInventory(env, token, adjustments, `woo-${order.channel}-${order.externalId ?? order.id}-${kind}`));
    return set({ status: "pushed", adjustments: adjustments.length, at: occurredAt, error: unlinked ? `${unlinked} lot(s) are not linked to Square` : undefined });
  } catch (e) {
    return set({ status: "failed", adjustments: adjustments.length, error: e instanceof Error ? e.message : String(e), at: occurredAt });
  }
}

/** Retries Square pushes that failed or never ran. */
export async function retrySquarePushes(ctx: ServerContext): Promise<{ retried: number; failed: number }> {
  const orders = (await ctx.store.list("orders")).filter((o) => o.bridge);
  let retried = 0;
  let failed = 0;
  for (const o of orders) {
    for (const kind of ["sale", "return"] as const) {
      const state = kind === "sale" ? o.bridge!.square : o.bridge!.reversed?.square;
      if (!isOutstanding(state)) continue;
      retried++;
      const after = await pushSquareForOrder(ctx, o.id, kind);
      if (after.status === "failed") failed++;
    }
  }
  return { retried, failed };
}

// ---- cumulusOS as the source of truth ("cumulus" mode) -----------------------------------

/** Each read of Square's history overlaps the last by this much, so a change Square records late is not missed; claims keep it from counting twice. */
const HISTORY_OVERLAP_MS = 15 * 60_000;

export interface SquareSyncResult {
  summary: string;
  /** Items whose stock changed here (counter sales and refunds), so their packs can be re-pushed. */
  itemIds: string[];
  sales: number;
  returns: number;
  elsewhere: number;
  counts: number;
  created: number;
  /** Animal cuts someone added in Square, brought in as lots. */
  adopted: number;
  short: number;
  problems: string[];
}

const normalLabel = (s: string | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

/** Counter sales and refunds into the lots they name: returns first, then sales, each through the ledger. */
async function applySquareImport(ctx: ServerContext, plan: ImportPlan): Promise<string[]> {
  const touched = new Set<string>();
  if (plan.returns.length) {
    const lots = new Map((await ctx.store.list("lots")).map((l) => [l.id, l]));
    const lotQty = new Map<string, number>();
    const inputs: MovementInput[] = [];
    for (const r of plan.returns) {
      const lot = lots.get(r.lotId);
      if (!lot) continue;
      inputs.push({ itemId: r.itemId, type: "rma_return", qty: r.qty, lotId: r.lotId, refType: "channel", reason: "Square counter refund", note: `${lot.supplierLot ?? ""} · ${r.via}`.trim(), occurredAt: r.occurredAt });
      lotQty.set(r.lotId, round((lotQty.get(r.lotId) ?? lot.qtyRemaining) + r.qty, 3));
      touched.add(r.itemId);
    }
    if (inputs.length) {
      const mv = await movementOps(ctx.store, BRIDGE_ACTOR, inputs);
      await ctx.store.batch([...mv.ops, ...Array.from(lotQty.entries()).map<WriteOp>(([id, qtyRemaining]) => ({ op: "patch", collection: "lots", id, patch: { qtyRemaining } }))]);
    }
  }
  const sales = plan.sales.filter((s) => s.qty > 0);
  if (sales.length) {
    const lots = new Map((await ctx.store.list("lots")).map((l) => [l.id, l]));
    const inputs: MovementInput[] = sales.map((s) => ({ itemId: s.itemId, type: "sale", qty: -s.qty, fromLotIds: [s.lotId], refType: "channel", reason: "Square counter sale", note: `${lots.get(s.lotId)?.supplierLot ?? ""} · ${s.via}`.trim(), occurredAt: s.occurredAt }));
    sales.forEach((s) => touched.add(s.itemId));
    const mv = await movementOps(ctx.store, BRIDGE_ACTOR, inputs);
    await ctx.store.batch(mv.ops);
  }
  return Array.from(touched);
}

/**
 * The cumulus-mode pass: counter sales and refunds come in from Square's
 * history, lots received here that Square does not list yet become "Lot #"
 * variations, and Square's counts are set to what the lots hold (the ones
 * named, or all of them). Changes made in Square some other way are reported
 * in the activity log and put back by the same count push.
 */
export async function syncSquareFromCumulus(ctx: ServerContext, opts: { lotIds?: string[]; variationIds?: string[]; reason?: string } = {}): Promise<SquareSyncResult> {
  const result: SquareSyncResult = { summary: "", itemIds: [], sales: 0, returns: 0, elsewhere: 0, counts: 0, created: 0, adopted: 0, short: 0, problems: [] };
  const conn = await connected(ctx, "square");
  if (!conn) return { ...result, summary: "Square is not connected" };
  const { integration, secrets } = conn;
  if (ranchMode(integration) !== "cumulus") return { ...result, summary: "Square holds the counts" };
  const locationId = squareLocationId(integration);
  const since = integration.config?.ranchChangesAfter || nowIso();
  const reason = opts.reason ?? "sync";

  return square.withSquareToken(ctx, secrets, async (token, env) => {
    const [history, catalog] = await Promise.all([
      square.listInventoryChanges(env, token, { locationIds: [locationId], updatedAfter: new Date(Date.parse(since) - HISTORY_OVERLAP_MS).toISOString() }),
      square.listCatalogObjects(env, token, ["ITEM", "MEASUREMENT_UNIT", "ITEM_OPTION"]),
    ]);

    // 1. Counter sales and refunds, each Square change claimed once.
    const { events, latest } = readSquareHistory(history, locationId);
    const fresh = [];
    for (const e of events) if (await claim(ctx, `sq-${e.id}`)) fresh.push(e);
    const plan = planSquareImport(fresh, await ctx.store.list("lots"));
    try {
      result.itemIds = await applySquareImport(ctx, plan);
    } catch (e) {
      await Promise.all(fresh.map((ev) => release(ctx, `sq-${ev.id}`)));
      throw e;
    }
    result.sales = plan.sales.length;
    result.returns = plan.returns.length;
    result.short = plan.sales.filter((s) => s.short > 0).length;
    result.elsewhere = plan.elsewhere.length;

    // Which lots to set: the ones asked for, plus any the counter oversold or someone changed in Square.
    const items = await ctx.store.list("items");
    let lots = await ctx.store.list("lots");
    const wantedVariations = opts.variationIds ? new Set(opts.variationIds) : null;
    const scope = opts.lotIds || opts.variationIds ? new Set<string>([...(opts.lotIds ?? []), ...lots.filter((l) => l.externalIds?.square && wantedVariations?.has(l.externalIds.square)).map((l) => l.id)]) : null;
    if (scope) {
      for (const s of plan.sales) if (s.short > 0) scope.add(s.lotId);
      for (const e of plan.elsewhere) if (e.lotId) scope.add(e.lotId);
    }

    // Square variations no lot follows. One with stock (an animal someone added in Square) is brought in as a
    // lot, so nothing on the shelf goes missing; one below zero (an old animal the counter oversold) is set to 0.
    const strayZero: string[] = [];
    if (!opts.lotIds || opts.variationIds) {
      const linkedNow = new Set(lots.map((l) => l.externalIds?.square).filter((v): v is string => !!v));
      const rows = catalogRows(catalog).filter((r) => r.unit !== "ea" && r.trackInventory);
      const strays = rows.filter((r) => !linkedNow.has(r.variationId) && (!wantedVariations || wantedVariations.has(r.variationId)));
      if (strays.length) {
        const strayCounts = await square.inventoryCounts(env, token, strays.map((r) => r.variationId), [locationId]);
        for (const r of strays) if ((strayCounts.get(r.variationId) ?? 0) < 0) strayZero.push(r.variationId);
        const adopt = new Set(strays.filter((r) => (strayCounts.get(r.variationId) ?? 0) > 0).map((r) => r.variationId));
        if (adopt.size) {
          const mplan = planMirror({ rows, counts: strayCounts, items, lots, excludedSkus: new Set((integration.excludedSkus ?? []).map((x) => x.toUpperCase())), onlyVariationIds: adopt, now: nowIso() });
          const adoptPlan: MirrorPlan = { ...mplan, changes: [], itemPatches: [] };
          if (adoptPlan.newLots.length) {
            const labels = Array.from(new Set(adoptPlan.newLots.map((l) => l.label))).slice(0, 5).join(", ");
            result.itemIds.push(...(await applyMirrorPlan(ctx, adoptPlan, nowIso(), `Square: brought in ${adoptPlan.newLots.length} animal cut${adoptPlan.newLots.length === 1 ? "" : "s"} added in Square (${labels}). Receive animals on Animals so Square follows from the start.`)));
            result.adopted = adoptPlan.newLots.length;
            lots = await ctx.store.list("lots");
          }
        }
      }
    }

    // 2. Lots received here that Square does not list yet become variations on their cut.
    const squareItems = new Set(items.filter((i) => i.externalIds?.square).map((i) => i.id));
    const unlinked = lots.filter((l) => !l.externalIds?.square && l.qtyRemaining > 0 && squareItems.has(l.itemId) && (!scope || scope.has(l.id)));
    if (unlinked.length) {
      const linked = new Set(lots.map((l) => l.externalIds?.square).filter((v): v is string => !!v));
      const vp = planNewVariations(unlinked, new Map(items.map((i) => [i.id, i])), catalog, linked);
      result.problems.push(...vp.problems);
      const ids = vp.objects.length ? await square.upsertCatalogObjects(env, token, vp.objects, `cumulus-animal-${newId("u")}`) : new Map<string, string>();
      const patches: WriteOp[] = [];
      for (const link of vp.links) {
        const variationId = link.variationId ?? (link.clientId ? ids.get(link.clientId) : undefined);
        if (!variationId) {
          result.problems.push("Square did not return a variation for a new animal; try Sync now.");
          continue;
        }
        patches.push({ op: "patch", collection: "lots", id: link.lotId, patch: { externalIds: { square: variationId } } });
        if (link.clientId) result.created++;
        scope?.add(link.lotId);
      }
      if (patches.length) {
        await ctx.store.batch(patches);
        lots = await ctx.store.list("lots");
      }
    }

    // 3. Square's counts set to what the lots hold.
    const precision = variationPrecision(catalog);
    const targets = lots.filter((l) => l.externalIds?.square && (!scope || scope.has(l.id)));
    const counts = targets.length ? await square.inventoryCounts(env, token, targets.map((l) => l.externalIds!.square!), [locationId]) : new Map<string, number>();
    const pushes = [...planCountPush(targets, counts, precision).map((p) => ({ variationId: p.variationId, quantity: p.to })), ...strayZero.map((variationId) => ({ variationId, quantity: 0 }))];
    if (pushes.length) {
      const at = nowIso();
      await square.setInventoryCounts(env, token, pushes.map((p) => ({ ...p, locationId, occurredAt: at, referenceId: `${OUR_REFERENCE}: ${reason}` })), `cumulus-counts-${newId("c")}`);
    }
    result.counts = pushes.length;

    result.summary = describeSquareSync({ ...result, salesLb: plan.sales.reduce((a, s) => a + s.qty, 0) });
    const notable = plan.sales.length || plan.returns.length || plan.elsewhere.length || result.created || strayZero.length;
    if (notable) {
      const lotById = new Map(lots.map((l) => [l.id, l]));
      const itemName = new Map(items.map((i) => [i.id, i.name]));
      const what = (lotId?: string) => {
        const lot = lotId ? lotById.get(lotId) : undefined;
        return lot ? `${itemName.get(lot.itemId) ?? "a cut"} ${lot.supplierLot ?? lot.number ?? ""}`.trim() : "a cut";
      };
      const putBack = plan.elsewhere.slice(0, 5).map((e) => `${what(e.lotId)} (${e.detail}, ${e.via})`);
      await ctx.store.batch([activityOp(BRIDGE_ACTOR, "integration.synced", `Square: ${result.summary}${putBack.length ? `. Put back to cumulusOS's count: ${putBack.join("; ")}${plan.elsewhere.length > 5 ? "…" : ""}` : ""}`, { entityType: "integration", entityId: "square" })]);
    }
    const fresher = await ctx.store.get("integrations", "square");
    const cursor = latest && latest > since ? latest : since;
    await ctx.store.patch("integrations", "square", { status: "connected", config: { ...(fresher?.config ?? integration.config), ranchChangesAfter: cursor }, lastSyncAt: nowIso(), lastSyncSummary: result.summary, lastError: result.problems[0] });
    return result;
  });
}

export interface ModePlan {
  mode: RanchMode;
  applied: boolean;
  /** Square counts that change when cumulusOS takes over (mostly counts below zero going to 0). */
  changes: Array<{ cut: string; animal: string; from: number; to: number }>;
  changed: number;
  /** Counts below zero in Square that become 0. */
  negatives: number;
  negativeLb: number;
  summary: string;
}

/**
 * Hands the counts to cumulusOS (or back to Square). Taking over first brings
 * every lot up to Square's current counts, then sets Square to match cumulusOS,
 * which mostly means Square's counts below zero become 0. `dryRun` reports that
 * without changing Square or the mode.
 */
export async function switchRanchMode(ctx: ServerContext, to: RanchMode, opts: { dryRun?: boolean } = {}): Promise<ModePlan> {
  requireRanch(ctx);
  const conn = await connected(ctx, "square");
  if (!conn) throw new HttpError(409, "Connect Square first.");
  const from = ranchMode(conn.integration);
  const base: ModePlan = { mode: to, applied: false, changes: [], changed: 0, negatives: 0, negativeLb: 0, summary: "" };
  if (to === "square") {
    if (opts.dryRun) return { ...base, summary: "Square holds the counts again: receive animals and recount in Square, and cumulusOS follows its numbers." };
    const config = { ...(conn.integration.config ?? {}) };
    delete config.ranchChangesAfter;
    await ctx.store.patch("integrations", "square", { config: { ...config, ranchMode: "square" } });
    const mirror = await runSquareMirror(ctx);
    await ctx.store.batch([activityOp(ctx.actor, "integration.synced", `Square holds the ranch counts again (${mirror.summary})`, { entityType: "integration", entityId: "square" })]);
    return { ...base, applied: true, summary: mirror.summary };
  }
  // Up to date with Square before taking over, so nothing sold at the counter is lost.
  if (from === "square") await runSquareMirror(ctx);
  const [lots, items] = await Promise.all([ctx.store.list("lots"), ctx.store.list("items")]);
  const linkedIds = new Set(lots.map((l) => l.externalIds?.square).filter((v): v is string => !!v));
  const locationId = squareLocationId(conn.integration);
  const { counts, precision, rows } = await square.withSquareToken(ctx, conn.secrets, async (token, env) => {
    const catalog = await square.listCatalogObjects(env, token, ["ITEM", "MEASUREMENT_UNIT"]);
    const rows = catalogRows(catalog).filter((r) => r.unit !== "ea" && r.trackInventory);
    return { rows, precision: variationPrecision(catalog), counts: await square.inventoryCounts(env, token, Array.from(new Set([...linkedIds, ...rows.map((r) => r.variationId)])), [locationId]) };
  });
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const itemName = new Map(items.map((i) => [i.id, i.name]));
  // Every Square count that changes: lots that differ, and animals with no lot here that are below zero (sold out, oversold).
  const pushes = [
    ...planCountPush(lots.filter((l) => l.externalIds?.square), counts, precision).map((p) => ({ cut: itemName.get(lotById.get(p.lotId)?.itemId ?? "") ?? "A cut", animal: lotById.get(p.lotId)?.supplierLot ?? "", from: p.from, to: p.to })),
    ...rows.filter((r) => !linkedIds.has(r.variationId) && (counts.get(r.variationId) ?? 0) < 0).map((r) => ({ cut: r.itemName, animal: r.variationName, from: counts.get(r.variationId) ?? 0, to: 0 })),
  ];
  const negatives = pushes.filter((p) => p.from < 0);
  const plan: ModePlan = {
    ...base,
    changes: [...pushes].sort((a, b) => Math.abs(b.from - b.to) - Math.abs(a.from - a.to)).slice(0, 12),
    changed: pushes.length,
    negatives: negatives.length,
    negativeLb: round(negatives.reduce((a, p) => a + p.from, 0), 2),
    summary: pushes.length ? `${pushes.length} Square count${pushes.length === 1 ? "" : "s"} change${pushes.length === 1 ? "s" : ""}${negatives.length ? `, ${negatives.length} of them below zero going to 0` : ""}.` : "Square already matches cumulusOS.",
  };
  if (opts.dryRun) return plan;
  await ctx.store.patch("integrations", "square", { config: { ...(conn.integration.config ?? {}), ranchMode: "cumulus", ranchChangesAfter: nowIso() } });
  const r = await syncSquareFromCumulus(ctx, { reason: "cumulusOS became the source of truth" });
  await ctx.store.batch([activityOp(ctx.actor, "integration.synced", `cumulusOS now holds the ranch counts; Square follows (${r.summary})`, { entityType: "integration", entityId: "square" })]);
  return { ...plan, applied: true, summary: r.summary };
}

function requireCumulusCounts(integration: Integration | null): void {
  if (integration && integration.status !== "not_connected" && ranchMode(integration) !== "cumulus") {
    throw new HttpError(409, "Square holds the counts right now, so receive and recount in Square. To do it here, make cumulusOS the source of truth on Square & store.");
  }
}

/**
 * Receives an animal: one lot per cut with its pounds, labelled the way the
 * counter knows it ("1980 - 31F - PURE"). With Square connected, each lot
 * becomes that animal's Lot # variation on the cut and Square's count is set.
 */
export async function receiveAnimal(ctx: ServerContext, input: { label: string; receivedAt?: string; cuts: Array<{ itemId: string; qty: number }> }): Promise<{ lots: number; pounds: number; summary: string; problems: string[] }> {
  requireRanch(ctx);
  const integration = await ctx.store.get("integrations", "square");
  requireCumulusCounts(integration);
  const label = input.label.trim().replace(/\s+/g, " ");
  if (!label) throw new HttpError(400, "Give the animal its Lot # (for example 1980 - 31F - PURE).");
  if (label.length > 120) throw new HttpError(400, "That Lot # is too long.");
  const cuts = input.cuts.map((c) => ({ itemId: c.itemId, qty: round(Number(c.qty), 3) })).filter((c) => c.qty > 0);
  if (cuts.length === 0) throw new HttpError(400, "Enter the pounds of at least one cut.");
  if (new Set(cuts.map((c) => c.itemId)).size !== cuts.length) throw new HttpError(400, "Each cut appears once.");
  const receivedAt = input.receivedAt && !Number.isNaN(Date.parse(input.receivedAt)) ? new Date(input.receivedAt).toISOString() : nowIso();
  const [items, lots] = await Promise.all([ctx.store.list("items"), ctx.store.list("lots")]);
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const c of cuts) {
    const item = byId.get(c.itemId);
    if (!item) throw new HttpError(400, "One of the cuts no longer exists; reload and try again.");
    if (lots.some((l) => l.itemId === c.itemId && normalLabel(l.supplierLot) === normalLabel(label))) throw new HttpError(409, `${item.name} already has animal ${label}. Recount that lot on Animals instead.`);
  }
  const { numbers, ops: numberOps } = await nextNumbers(ctx.store, { lot: cuts.length });
  const lotDocs: Lot[] = cuts.map((c, i) => ({ id: newId("lot"), number: numbers.lot[i], itemId: c.itemId, supplierLot: label, source: "receipt", qtyReceived: c.qty, qtyRemaining: c.qty, unitCost: 0, receivedAt }));
  const mv = await movementOps(ctx.store, ctx.actor, lotDocs.map((l) => ({ itemId: l.itemId, type: "receipt", qty: l.qtyReceived, lotId: l.id, refType: "manual", reason: "Animal received", note: label, occurredAt: receivedAt })));
  const pounds = round(cuts.reduce((a, c) => a + c.qty, 0), 3);
  await ctx.store.batch([...numberOps, ...lotDocs.map<WriteOp>((doc) => ({ op: "put", collection: "lots", doc })), ...mv.ops, activityOp(ctx.actor, "stock.received", `Animal ${label} received: ${pounds} lb across ${cuts.length} cut${cuts.length === 1 ? "" : "s"}`)]);
  let summary = `${pounds} lb across ${cuts.length} cut${cuts.length === 1 ? "" : "s"}`;
  const problems: string[] = [];
  if (integration && integration.status !== "not_connected") {
    try {
      const r = await syncSquareFromCumulus(ctx, { lotIds: lotDocs.map((l) => l.id), reason: `animal ${label} received` });
      summary += `; Square: ${r.summary}`;
      problems.push(...r.problems);
    } catch (e) {
      problems.push(`Saved here, but Square was not updated: ${e instanceof Error ? e.message : String(e)}. Sync now tries again.`);
    }
  }
  await pushPacks(ctx, { itemIds: cuts.map((c) => c.itemId) }).catch(() => undefined);
  return { lots: lotDocs.length, pounds, summary, problems };
}

/** Sets one lot (one animal's share of a cut) to the pounds counted, then Square's count to match. */
export async function recountLot(ctx: ServerContext, input: { lotId: string; qty: number; note?: string }): Promise<{ summary: string; problems: string[] }> {
  requireRanch(ctx);
  const integration = await ctx.store.get("integrations", "square");
  requireCumulusCounts(integration);
  const lot = await ctx.store.get("lots", input.lotId);
  if (!lot) throw new HttpError(404, "That lot no longer exists.");
  const qty = round(Number(input.qty), 3);
  if (!Number.isFinite(qty) || qty < 0) throw new HttpError(400, "Enter the pounds counted (0 or more).");
  const delta = round(qty - lot.qtyRemaining, 3);
  if (delta === 0) return { summary: "unchanged", problems: [] };
  const note = [lot.supplierLot, input.note?.trim()].filter(Boolean).join(" · ") || undefined;
  const mv = await movementOps(ctx.store, ctx.actor, [delta > 0 ? { itemId: lot.itemId, type: "count", qty: delta, lotId: lot.id, refType: "count", reason: "Recount", note } : { itemId: lot.itemId, type: "count", qty: delta, fromLotIds: [lot.id], refType: "count", reason: "Recount", note }]);
  const ops: WriteOp[] = [...mv.ops];
  if (delta > 0) ops.push({ op: "patch", collection: "lots", id: lot.id, patch: { qtyRemaining: qty, qtyReceived: Math.max(lot.qtyReceived, qty) } });
  await ctx.store.batch(ops);
  const problems: string[] = [];
  let summary = `${lot.supplierLot ?? lot.number ?? "Lot"} now ${qty} lb`;
  if (integration && integration.status !== "not_connected") {
    try {
      const r = await syncSquareFromCumulus(ctx, { lotIds: [lot.id], reason: "recount" });
      summary += `; Square: ${r.summary}`;
      problems.push(...r.problems);
    } catch (e) {
      problems.push(`Saved here, but Square was not updated: ${e instanceof Error ? e.message : String(e)}. Sync now tries again.`);
    }
  }
  await pushPacks(ctx, { itemIds: [lot.itemId] }).catch(() => undefined);
  return { summary, problems };
}

// ---- cumulusOS → WooCommerce -------------------------------------------------------------

export interface PushResult {
  pushed: number;
  priced: number;
  /** Listings whose SKU is on no store product. */
  unlinked: string[];
  errors: string[];
  summary: string;
}

/**
 * Sends packs available and web prices to the store. Only listings whose
 * numbers changed since the last push are written, unless `force`.
 */
export async function pushPacks(ctx: ServerContext, opts: { itemIds?: string[]; listingIds?: string[]; force?: boolean } = {}): Promise<PushResult> {
  const result: PushResult = { pushed: 0, priced: 0, unlinked: [], errors: [], summary: "" };
  const conn = await connected(ctx, "woocommerce");
  if (!conn) return { ...result, summary: "WooCommerce is not connected" };
  const creds = await wooCreds(ctx, conn.integration, conn.secrets);
  const [allListings, items] = await Promise.all([ctx.store.list("packs"), ctx.store.list("items")]);
  let listings = allListings.filter((l) => l.sku || l.woo);
  if (opts.listingIds) listings = listings.filter((l) => opts.listingIds!.includes(l.id));
  if (opts.itemIds) listings = listingsUsing(listings, opts.itemIds);
  // An inactive listing that was on sale before is pushed once more at zero; one never pushed is left alone.
  listings = listings.filter((l) => l.active || l.pushed);
  if (listings.length === 0) return { ...result, summary: "no packs to push" };
  const byId = new Map(items.map((i) => [i.id, i]));
  const now = nowIso();

  // Link listings to store products by SKU the first time.
  const unlinkedSkus = listings.filter((l) => !l.woo && l.sku).map((l) => l.sku.toUpperCase());
  const found = unlinkedSkus.length ? await woo.findProductsBySku(creds, unlinkedSkus) : new Map<string, woo.WooRef>();
  const patches = new Map<string, Partial<PackListing>>();
  const stockUpdates: Array<woo.WooRef & { qty: number; listingId: string }> = [];
  for (const l of listings) {
    const ref = l.woo ?? found.get(l.sku.toUpperCase());
    if (!ref) {
      result.unlinked.push(l.sku || l.name);
      patches.set(l.id, { pushError: `No store product has SKU ${l.sku || "(none)"}.` });
      continue;
    }
    if (!l.woo) patches.set(l.id, { woo: ref });
    const stock = packsAvailable(l, byId);
    if (opts.force || l.pushed?.stock !== stock || !l.pushed) stockUpdates.push({ ...ref, qty: stock, listingId: l.id });
    if (l.active && l.price > 0 && (opts.force || l.pushed?.price !== l.price)) {
      try {
        await woo.updateProduct(creds, ref, { price: l.price });
        result.priced++;
      } catch (e) {
        result.errors.push(`${l.name}: ${e instanceof Error ? e.message : String(e)}`);
        patches.set(l.id, { ...(patches.get(l.id) ?? {}), pushError: e instanceof Error ? e.message : String(e) });
        continue;
      }
    }
    patches.set(l.id, { ...(patches.get(l.id) ?? {}), pushed: { stock, price: l.price, at: now }, pushError: undefined });
  }
  if (stockUpdates.length) {
    try {
      await woo.batchUpdateStock(creds, stockUpdates);
      result.pushed = stockUpdates.length;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      result.errors.push(message);
      for (const u of stockUpdates) patches.set(u.listingId, { ...(patches.get(u.listingId) ?? {}), pushed: listings.find((l) => l.id === u.listingId)!.pushed, pushError: message });
    }
  }
  if (patches.size) await ctx.store.batch(Array.from(patches.entries()).map<WriteOp>(([id, patch]) => ({ op: "patch", collection: "packs", id, patch: { ...patch, updatedAt: now } })));
  result.summary = [`${result.pushed} stock level${result.pushed === 1 ? "" : "s"}`, `${result.priced} price${result.priced === 1 ? "" : "s"}`, result.unlinked.length ? `${result.unlinked.length} not on the store` : "", result.errors.length ? `${result.errors.length} error${result.errors.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(", ");
  await ctx.store.patch("integrations", "woocommerce", { lastSyncAt: now, lastSyncSummary: `Packs pushed: ${result.summary}`, ...(result.errors.length ? { lastError: result.errors[0] } : { lastError: undefined }) });
  return result;
}

// ---- WooCommerce → cumulusOS ---------------------------------------------------------------

const SOLD = new Set(["processing", "completed", "on-hold"]);
const REVERSED = new Set(["cancelled", "refunded", "failed", "trash"]);

/** A per-order claim so the store's near-simultaneous created/updated deliveries record a sale once. */
async function claim(ctx: ServerContext, key: string): Promise<boolean> {
  try {
    await ctx.db.doc(`workspaces/${ctx.workspaceId}/bridgeLocks/${key}`).create({ at: nowIso() });
    return true;
  } catch (e) {
    if ((e as { code?: number }).code === 6) return false;
    throw e;
  }
}

async function release(ctx: ServerContext, key: string): Promise<void> {
  await ctx.db.doc(`workspaces/${ctx.workspaceId}/bridgeLocks/${key}`).delete().catch(() => {});
}

function storeLines(o: woo.WooOrder): StoreLine[] {
  return o.line_items.map((li) => ({ sku: li.sku, productId: String(li.product_id), variationId: li.variation_id ? String(li.variation_id) : undefined, name: li.name, qty: li.quantity, unitPrice: Number(li.price) || 0 }));
}

/**
 * Records a web order: paid orders become a cumulusOS sale of the cuts' pounds
 * (oldest lot first) and the same pounds leave Square; a cancelled or refunded
 * order that was recorded puts them back.
 */
export async function recordWooOrder(ctx: ServerContext, o: woo.WooOrder): Promise<string> {
  const externalId = String(o.id);
  const existing = (await ctx.store.list("orders")).find((x) => x.channel === "woocommerce" && x.externalId === externalId);
  if (SOLD.has(o.status)) {
    if (existing) return "already recorded";
    const key = `woo-${externalId}`;
    if (!(await claim(ctx, key))) return "already recorded";
    try {
      const [listings, items] = await Promise.all([ctx.store.list("packs"), ctx.store.list("items")]);
      const expanded = expandOrder(storeLines(o), listings, new Map(items.map((i) => [i.id, i])));
      if (expanded.lines.length === 0) {
        await release(ctx, key);
        return expanded.unmatched.length ? `no packs on the order (${expanded.unmatched.join(", ")})` : "empty order";
      }
      const name = [o.shipping?.first_name || o.billing?.first_name, o.shipping?.last_name || o.billing?.last_name].filter(Boolean).join(" ").trim();
      const order = await createOrder(ctx.store, BRIDGE_ACTOR, {
        customer: name || o.billing?.email || `Web #${o.number}`,
        customerEmail: o.billing?.email || undefined,
        note: [o.customer_note, `Web packs: ${expanded.packs.map((p) => `${p.packs} × ${p.name}`).join(", ")}`, expanded.unmatched.length ? `Not packs, no stock taken: ${expanded.unmatched.join(", ")}` : ""].filter(Boolean).join("\n"),
        source: "woocommerce",
        channel: "woocommerce",
        externalId,
        externalRef: `#${o.number}`,
        lines: expanded.lines,
      });
      // Relieve what is on hand now; anything short stays open on the order as a backorder.
      const fresh = new Map((await ctx.store.list("items")).map((i) => [i.id, i]));
      const ship = expanded.lines.map((l) => ({ itemId: l.itemId, qty: round(Math.min(l.qty, Math.max(0, fresh.get(l.itemId)?.onHand ?? 0)), 3) })).filter((l) => l.qty > 0);
      const short = expanded.lines.map((l) => ({ itemId: l.itemId, qty: round(l.qty - (ship.find((s) => s.itemId === l.itemId)?.qty ?? 0), 3) })).filter((l) => l.qty > 0);
      if (ship.length) await shipOrder(ctx.store, BRIDGE_ACTOR, { orderId: order.id, lines: ship, note: "Taken from stock when the web order was paid" });
      const bridge: OrderBridge = { packs: expanded.packs, unmatched: expanded.unmatched.length ? expanded.unmatched : undefined, short: short.length ? short : undefined, square: { status: ship.length ? "pending" : "skipped" } };
      await ctx.store.patch("orders", order.id, { bridge });
      if (ship.length) await pushSquareForOrder(ctx, order.id, "sale");
      await pushPacks(ctx, { itemIds: expanded.lines.map((l) => l.itemId) }).catch(() => undefined);
      return short.length ? `recorded ${order.number}, ${short.length} cut(s) short` : `recorded ${order.number}`;
    } catch (e) {
      // Nothing was written if the order itself failed; let a retry claim it again.
      if (!(await ctx.store.list("orders")).some((x) => x.channel === "woocommerce" && x.externalId === externalId)) await release(ctx, key);
      throw e;
    }
  }
  if (REVERSED.has(o.status)) {
    if (!existing?.bridge || existing.bridge.reversed) return "nothing to reverse";
    const key = `woo-${externalId}-reversed`;
    if (!(await claim(ctx, key))) return "already reversed";
    return reverseOrder(ctx, existing, `Web order #${o.number} ${o.status}`);
  }
  return `ignored (${o.status})`;
}

/** Puts a recorded web order's pounds back into the lots they came from, here and (pushed after) in Square. */
async function reverseOrder(ctx: ServerContext, order: SalesOrder, reason: string): Promise<string> {
  const mine = (await ctx.store.list("movements")).filter((m) => m.refType === "order" && m.refId === order.id && m.type === "sale");
  const lots = new Map((await ctx.store.list("lots")).map((l) => [l.id, l]));
  const now = nowIso();
  const inputs: MovementInput[] = [];
  const lotPatches = new Map<string, number>();
  for (const m of mine) {
    for (const a of m.lots ?? []) {
      if (!lots.has(a.lotId)) continue;
      inputs.push({ itemId: m.itemId, type: "rma_return" as MovementType, qty: a.qty, lotId: a.lotId, refType: "order", refId: order.id, reason, occurredAt: now });
      lotPatches.set(a.lotId, round((lotPatches.get(a.lotId) ?? lots.get(a.lotId)!.qtyRemaining) + a.qty, 3));
    }
  }
  const bridge: OrderBridge = { ...order.bridge!, reversed: { at: now, square: { status: inputs.length ? "pending" : "skipped" } } };
  const ops: WriteOp[] = [];
  if (inputs.length) {
    const mv = await movementOps(ctx.store, BRIDGE_ACTOR, inputs);
    ops.push(...mv.ops, ...Array.from(lotPatches.entries()).map<WriteOp>(([id, qtyRemaining]) => ({ op: "patch", collection: "lots", id, patch: { qtyRemaining } })));
  }
  ops.push({ op: "patch", collection: "orders", id: order.id, patch: { status: "cancelled", bridge } });
  ops.push(activityOp(BRIDGE_ACTOR, "order.cancelled", `${reason}: ${order.number} put back into stock`, { entityType: "order", entityId: order.id }));
  await ctx.store.batch(ops);
  if (inputs.length) await pushSquareForOrder(ctx, order.id, "return");
  await pushPacks(ctx, { itemIds: Array.from(new Set(inputs.map((i) => i.itemId))) }).catch(() => undefined);
  return `reversed ${order.number}`;
}

/** Store webhooks on a ranch instance: only orders matter (products are driven from here). */
export async function handleRanchWooWebhook(ctx: ServerContext, topic: string, payload: unknown): Promise<string> {
  if (!topic.startsWith("order.")) return "ignored";
  const o = payload as woo.WooOrder;
  if (!o || typeof o.id !== "number" || !Array.isArray(o.line_items)) return "ignored (no order)";
  return recordWooOrder(ctx, o);
}

/** Square inventory.count.updated: re-mirror the variations it names, then re-push their packs. */
export async function handleSquareCountWebhook(ctx: ServerContext, payload: unknown): Promise<string> {
  const counts = (payload as { data?: { object?: { inventory_counts?: Array<{ catalog_object_id?: string }> } } })?.data?.object?.inventory_counts ?? [];
  const ids = Array.from(new Set(counts.map((c) => c.catalog_object_id).filter((x): x is string => !!x)));
  if (ids.length === 0) return "no counts";
  const integration = await ctx.store.get("integrations", "square");
  if (ranchMode(integration) === "cumulus") {
    // A counter sale comes in as a sale; any other change made in Square is put back. Our own count pushes land here too and change nothing.
    const r = await syncSquareFromCumulus(ctx, { variationIds: ids, reason: "Square changed" });
    if (r.itemIds.length) await pushPacks(ctx, { itemIds: r.itemIds }).catch(() => undefined);
    return r.summary;
  }
  const mirror = await runSquareMirror(ctx, { variationIds: ids });
  if (mirror.itemIds.length) await pushPacks(ctx, { itemIds: mirror.itemIds }).catch(() => undefined);
  return mirror.summary;
}

/**
 * The whole pass (Sync now, and the daily cron): Square counts in, outstanding
 * Square pushes retried, paid store orders the webhooks missed recorded, packs out.
 */
export async function ranchSync(ctx: ServerContext): Promise<{ summary: string; lines: string[] }> {
  requireRanch(ctx);
  const lines: string[] = [];
  try {
    const integration = await ctx.store.get("integrations", "square");
    lines.push(`Square: ${ranchMode(integration) === "cumulus" ? (await syncSquareFromCumulus(ctx, { reason: "sync" })).summary : (await runSquareMirror(ctx)).summary}`);
  } catch (e) {
    lines.push(`Square: ${e instanceof Error ? e.message : String(e)}`);
    await ctx.store.patch("integrations", "square", { lastError: e instanceof Error ? e.message : String(e) }).catch(() => {});
  }
  const retry = await retrySquarePushes(ctx);
  if (retry.retried) lines.push(`Square pushes retried: ${retry.retried}${retry.failed ? `, ${retry.failed} still failing` : ""}`);
  const wooConn = await connected(ctx, "woocommerce");
  if (wooConn) {
    try {
      const open = await woo.listOpenOrders(await wooCreds(ctx, wooConn.integration, wooConn.secrets));
      let recorded = 0;
      for (const o of open) if ((await recordWooOrder(ctx, o)).startsWith("recorded")) recorded++;
      if (recorded) lines.push(`Web orders recorded: ${recorded}`);
    } catch (e) {
      lines.push(`Web orders: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      lines.push(`Store: ${(await pushPacks(ctx)).summary}`);
    } catch (e) {
      lines.push(`Store: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else lines.push("Store: WooCommerce is not connected");
  return { summary: lines.join(" · "), lines };
}
