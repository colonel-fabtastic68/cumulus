import type { Item, PurchaseOrder, ReplenishmentRule, SalesOrder, StockAlertRule, StockMovement, Supplier } from "@/lib/types";
import type { Store } from "@/lib/store/types";
import { activityOp, bulkPatchItems, consumptionRate, explodeBom, isOrderOpen, lowStockLine, openQty, updateItem, InventoryError, type Actor } from "@/lib/inventory";
import { addPurchaseOrderLines, createPurchaseOrder, poIsOpen, poLineOpenQty, unitCostFor } from "@/lib/purchaseOrders";
import { round, sum } from "@/lib/utils";

/**
 * Replenishment: what to order or build, and when, from the forecast rather
 * than the shelf count. Forecast = on hand + what is already on order (and in
 * transit) − what open sales orders and suggested builds will take. An item
 * whose forecast dips below its low line is proposed up to its max (or twice
 * its min), rounded up to its order multiple, with the date to order by so
 * the goods land before the shelf runs dry at the recent usage rate.
 */

export type ReplenishmentRoute = "buy" | "build";
export type ReplenishmentStatus = "order" | "covered" | "snoozed" | "ok";

export interface ReplenishmentRow {
  item: Item;
  route: ReplenishmentRoute;
  supplier?: Supplier;
  leadTimeDays?: number;
  onHand: number;
  /** Still due on open purchase orders, plus units in transit between locations. */
  incoming: number;
  /** Open sales order lines not yet shipped, plus components for suggested builds. */
  outgoing: number;
  forecast: number;
  /** The low line under the workspace's stock alert rule. Undefined when the item has none. */
  min?: number;
  max?: number;
  /** Units consumed per day over the last 90 days (sales and builds). */
  dailyUsage: number;
  /** Days until the forecast dips below the low line at the usage rate; null without usage. */
  daysOfCover: number | null;
  /** Suggested quantity; 0 when nothing is needed. */
  toOrder: number;
  unitCost: number;
  estCost: number;
  /** Place the order by this date (YYYY-MM-DD) so it lands in time; undefined without usage data. */
  orderBy?: string;
  /** The order-by date has passed, or the forecast is already below min with a lead time ahead. */
  late: boolean;
  status: ReplenishmentStatus;
  auto: boolean;
  snoozedUntil?: string;
  multiple?: number;
  /** Open purchase orders that carry this item. */
  openPos: PurchaseOrder[];
}

export interface ReplenishmentInput {
  items: Item[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  orders: SalesOrder[];
  movements: StockMovement[];
  rule?: StockAlertRule;
  now?: number;
}

const DAY = 86_400_000;
const USAGE_WINDOW_DAYS = 90;

export function routeFor(item: Item): ReplenishmentRoute {
  return item.replenishment?.route ?? (item.type === "assembly" && item.bom.length > 0 ? "build" : "buy");
}

/** Rounds a quantity up to the item's order multiple (case size, pack). */
export function roundToMultiple(qty: number, multiple?: number): number {
  if (!multiple || multiple <= 0 || qty <= 0) return round(qty, 3);
  return round(Math.ceil(qty / multiple - 1e-9) * multiple, 3);
}

function toDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The replenishment plan for every item with a low line (or a replenishment
 * rule). Items above their line, those whose incoming stock covers them, and
 * snoozed items are all included with their status so views can filter.
 */
export function replenishmentPlan(input: ReplenishmentInput): ReplenishmentRow[] {
  const now = input.now ?? Date.now();
  const today = toDate(now);
  const supplierById = new Map(input.suppliers.map((s) => [s.id, s]));
  const rates = consumptionRate(input.movements, USAGE_WINDOW_DAYS);

  const incoming = new Map<string, number>();
  const openPos = new Map<string, PurchaseOrder[]>();
  for (const po of input.purchaseOrders) {
    if (!poIsOpen(po)) continue;
    for (const l of po.lines) {
      const open = poLineOpenQty(l);
      if (open <= 0) continue;
      incoming.set(l.itemId, round((incoming.get(l.itemId) ?? 0) + open, 4));
      (openPos.get(l.itemId) ?? openPos.set(l.itemId, []).get(l.itemId)!).push(po);
    }
  }
  const demand = new Map<string, number>();
  for (const o of input.orders) {
    if (!isOrderOpen(o)) continue;
    for (const l of o.lines) {
      const open = openQty(l);
      if (open > 0) demand.set(l.itemId, round((demand.get(l.itemId) ?? 0) + open, 4));
    }
  }

  const candidates = input.items.filter((i) => i.status === "active" && (lowStockLine(i, input.rule) !== undefined || i.replenishment));
  const buildDemand = new Map<string, number>();

  const compute = (item: Item): ReplenishmentRow => {
    const route = routeFor(item);
    const supplier = item.supplierId ? supplierById.get(item.supplierId) : undefined;
    const leadTimeDays = item.leadTimeDays ?? supplier?.leadTimeDays;
    const min = lowStockLine(item, input.rule);
    const max = item.maxQty !== undefined && (min === undefined || item.maxQty > min) ? item.maxQty : undefined;
    const inc = round((incoming.get(item.id) ?? 0) + (item.inTransit ?? 0), 4);
    const out = round((demand.get(item.id) ?? 0) + (buildDemand.get(item.id) ?? 0), 4);
    const forecast = round(item.onHand + inc - out, 4);
    const dailyUsage = rates.get(item.id) ?? 0;
    const rule = item.replenishment;
    const snoozed = !!rule?.snoozedUntil && rule.snoozedUntil >= today;
    let toOrder = 0;
    if (min !== undefined && forecast < min) {
      const target = max ?? min * 2;
      toOrder = roundToMultiple(Math.max(0, target - forecast), rule?.multiple);
      if (toOrder <= 0) toOrder = roundToMultiple(1, rule?.multiple);
    }
    const daysOfCover = dailyUsage > 0 ? Math.max(0, Math.floor((forecast - (min ?? 0)) / dailyUsage)) : null;
    let orderBy: string | undefined;
    let late = false;
    if (dailyUsage > 0 && min !== undefined) {
      const slack = Math.floor((forecast - min) / dailyUsage) - (leadTimeDays ?? 0);
      orderBy = toDate(now + Math.max(0, slack) * DAY);
      late = slack < 0;
    } else if (toOrder > 0 && (leadTimeDays ?? 0) > 0) {
      late = true;
    }
    const unitCost = route === "buy" ? unitCostFor(item, supplier?.id) : item.unitCost;
    const status: ReplenishmentStatus = snoozed ? "snoozed" : toOrder > 0 ? "order" : min !== undefined && item.onHand < min ? "covered" : "ok";
    return {
      item,
      route,
      supplier,
      leadTimeDays,
      onHand: item.onHand,
      incoming: inc,
      outgoing: out,
      forecast,
      min,
      max,
      dailyUsage: round(dailyUsage, 3),
      daysOfCover,
      toOrder,
      unitCost,
      estCost: round(toOrder * unitCost),
      orderBy,
      late,
      status,
      auto: !!rule?.auto,
      snoozedUntil: rule?.snoozedUntil,
      multiple: rule?.multiple,
      openPos: openPos.get(item.id) ?? [],
    };
  };

  // Suggested builds pull components, which may push those below their own line: iterate until the
  // build demand settles (a few passes cover any realistic BOM depth).
  let rows: ReplenishmentRow[] = [];
  for (let pass = 0; pass < 4; pass++) {
    rows = candidates.map(compute);
    const next = new Map<string, number>();
    for (const r of rows) {
      if (r.route !== "build" || r.status !== "order") continue;
      for (const req of explodeBom(input.items, r.item, r.toOrder, { consumeSubassemblies: true })) {
        next.set(req.item.id, round((next.get(req.item.id) ?? 0) + req.required, 4));
      }
    }
    const same = next.size === buildDemand.size && Array.from(next).every(([k, v]) => buildDemand.get(k) === v);
    buildDemand.clear();
    for (const [k, v] of next) buildDemand.set(k, v);
    if (same) break;
  }
  return rows.sort((a, b) => Number(b.status === "order") - Number(a.status === "order") || Number(b.late) - Number(a.late) || (a.orderBy ?? "9999").localeCompare(b.orderBy ?? "9999") || a.item.sku.localeCompare(b.item.sku));
}

export interface ReplenishmentSummary {
  toOrder: number;
  late: number;
  covered: number;
  snoozed: number;
  auto: number;
  estCost: number;
  suppliers: number;
  builds: number;
}

export function replenishmentSummary(rows: ReplenishmentRow[]): ReplenishmentSummary {
  const order = rows.filter((r) => r.status === "order");
  return {
    toOrder: order.length,
    late: order.filter((r) => r.late).length,
    covered: rows.filter((r) => r.status === "covered").length,
    snoozed: rows.filter((r) => r.status === "snoozed").length,
    auto: rows.filter((r) => r.auto).length,
    estCost: round(sum(order.filter((r) => r.route === "buy").map((r) => r.estCost))),
    suppliers: new Set(order.filter((r) => r.route === "buy").map((r) => r.supplier?.id ?? "")).size,
    builds: order.filter((r) => r.route === "build").length,
  };
}

/** The plan straight from a store (Strato, the cron). */
export async function loadReplenishmentPlan(store: Store): Promise<ReplenishmentRow[]> {
  const [items, suppliers, purchaseOrders, orders, movements, settings] = await Promise.all([store.list("items"), store.list("suppliers"), store.list("purchaseOrders"), store.list("orders"), store.list("movements"), store.list("settings")]);
  return replenishmentPlan({ items, suppliers, purchaseOrders, orders, movements, rule: settings[0]?.stockAlerts });
}
const loadPlan = loadReplenishmentPlan;

export interface ReplenishSelection {
  itemId: string;
  /** Override the suggested quantity. */
  qty?: number;
  /** Order from this supplier instead of the item's primary one. */
  supplierId?: string;
}

export interface ReplenishOptions {
  source?: "replenishment" | "strato" | "auto";
  /** Mark the new orders sent straight away. */
  send?: boolean;
  /** Add lines to an existing draft for the supplier instead of opening another order. Default true. */
  mergeIntoDrafts?: boolean;
  /** Expected date for new orders; defaults to today plus the supplier's lead time. */
  expectedAt?: string;
}

export interface ReplenishResult {
  created: PurchaseOrder[];
  /** Drafts that took extra lines. */
  updated: PurchaseOrder[];
  /** Assemblies to build rather than buy (nothing is created for them; build from the BOM page). */
  builds: Array<{ item: Item; qty: number }>;
  skipped: Array<{ item: Item; reason: string }>;
}

/**
 * Turns replenishment rows into purchase orders, one per supplier. A draft
 * already open for the supplier takes the lines instead of a second order
 * being raised, so the week's needs collect on one document until it is sent.
 */
export async function replenish(store: Store, actor: Actor, selections: ReplenishSelection[], opts: ReplenishOptions = {}): Promise<ReplenishResult> {
  if (selections.length === 0) throw new InventoryError("Nothing selected to replenish");
  const [rows, items, suppliers, purchaseOrders] = await Promise.all([loadPlan(store), store.list("items"), store.list("suppliers"), store.list("purchaseOrders")]);
  const rowById = new Map(rows.map((r) => [r.item.id, r]));
  const result: ReplenishResult = { created: [], updated: [], builds: [], skipped: [] };
  const groups = new Map<string, { supplier: Supplier; lines: Array<{ itemId: string; qty: number; unitCost: number }> }>();
  for (const sel of selections) {
    const item = items.find((i) => i.id === sel.itemId);
    if (!item) throw new InventoryError(`Unknown item ${sel.itemId}`);
    const row = rowById.get(item.id);
    const qty = sel.qty !== undefined ? roundToMultiple(Number(sel.qty), item.replenishment?.multiple) : (row?.toOrder ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      result.skipped.push({ item, reason: row?.status === "covered" ? "covered by stock already on order" : "nothing to order" });
      continue;
    }
    const route = routeFor(item);
    if (route === "build") {
      result.builds.push({ item, qty });
      continue;
    }
    const supplierId = sel.supplierId ?? item.supplierId;
    const supplier = supplierId ? suppliers.find((s) => s.id === supplierId) : undefined;
    if (!supplier) {
      result.skipped.push({ item, reason: "no supplier on the item" });
      continue;
    }
    const group = groups.get(supplier.id) ?? { supplier, lines: [] };
    const existing = group.lines.find((l) => l.itemId === item.id);
    if (existing) existing.qty = round(existing.qty + qty, 4);
    else group.lines.push({ itemId: item.id, qty, unitCost: unitCostFor(item, supplier.id) });
    groups.set(supplier.id, group);
  }
  const mergeIntoDrafts = opts.mergeIntoDrafts !== false;
  for (const group of groups.values()) {
    const draft = mergeIntoDrafts ? purchaseOrders.filter((p) => p.status === "draft" && p.supplierId === group.supplier.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] : undefined;
    if (draft) {
      const { po, added } = await addPurchaseOrderLines(store, actor, draft.id, group.lines);
      await store.batch([activityOp(actor, "po.created", `${actor.name} added ${added} line${added === 1 ? "" : "s"} to ${po.number} (${po.supplier}) from replenishment`, { entityType: "purchaseOrder", entityId: po.id, meta: { lines: added, source: opts.source ?? "replenishment" } })]);
      result.updated.push(po);
      continue;
    }
    const lead = group.supplier.leadTimeDays ?? 0;
    const expectedAt = opts.expectedAt ?? (lead > 0 ? toDate(Date.now() + lead * DAY) : undefined);
    const po = await createPurchaseOrder(store, actor, { supplierId: group.supplier.id, lines: group.lines, expectedAt, terms: group.supplier.terms, source: opts.source ?? "replenishment", send: opts.send });
    result.created.push(po);
  }
  return result;
}

/** Cleans a rule for storage: drops empty fields; an empty rule is removed from the item. */
function cleanRule(rule: Partial<ReplenishmentRule>): ReplenishmentRule | undefined {
  const out: ReplenishmentRule = {};
  if (rule.route) out.route = rule.route;
  if (rule.auto) out.auto = true;
  if (rule.multiple !== undefined && Number.isFinite(rule.multiple) && rule.multiple > 0) out.multiple = rule.multiple;
  if (rule.snoozedUntil) out.snoozedUntil = rule.snoozedUntil;
  return Object.keys(out).length ? out : undefined;
}

/** Sets part of an item's replenishment rule (route, automation, order multiple, snooze). */
export async function setReplenishmentRule(store: Store, actor: Actor, itemId: string, patch: Partial<ReplenishmentRule>, reason = "Replenishment rule"): Promise<void> {
  const item = await store.get("items", itemId);
  if (!item) throw new InventoryError("Item not found");
  const merged = { ...(item.replenishment ?? {}), ...patch };
  for (const key of Object.keys(patch) as Array<keyof ReplenishmentRule>) if (patch[key] === undefined || patch[key] === null) delete merged[key];
  await updateItem(store, actor, itemId, { replenishment: cleanRule(merged) }, reason);
}

/** Hides items from Replenishment until a date (null clears the snooze). */
export async function snoozeReplenishment(store: Store, actor: Actor, itemIds: string[], until: string | null): Promise<number> {
  const items = await store.list("items");
  const patches = itemIds.flatMap((id) => {
    const item = items.find((i) => i.id === id);
    if (!item) return [];
    const rule = { ...(item.replenishment ?? {}) };
    if (until) rule.snoozedUntil = until;
    else delete rule.snoozedUntil;
    return [{ id, patch: { replenishment: cleanRule(rule) } }];
  });
  return bulkPatchItems(store, actor, patches, until ? `Replenishment snoozed until ${until}` : "Replenishment snooze cleared");
}

/**
 * The automatic pass: every item flagged auto whose forecast is below its line
 * gets ordered, merging into the supplier's open draft. Run daily on hosted
 * workspaces; returns a one-line summary for the cron report.
 */
export async function autoReplenish(store: Store, actor: Actor): Promise<string> {
  const rows = (await loadPlan(store)).filter((r) => r.auto && r.status === "order" && r.route === "buy");
  if (rows.length === 0) return "nothing to order";
  const result = await replenish(store, actor, rows.map((r) => ({ itemId: r.item.id })), { source: "auto" });
  const parts = [result.created.length ? `${result.created.length} order${result.created.length === 1 ? "" : "s"} drafted (${result.created.map((p) => p.number).join(", ")})` : "", result.updated.length ? `${result.updated.length} draft${result.updated.length === 1 ? "" : "s"} extended (${result.updated.map((p) => p.number).join(", ")})` : "", result.skipped.length ? `${result.skipped.length} skipped` : ""].filter(Boolean);
  return parts.join(", ") || "nothing to order";
}
