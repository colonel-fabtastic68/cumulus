/**
 * Client-side tool execution. Maps agent tool calls onto inventory services.
 * Everything here runs in the browser against the active store.
 */
import type { Item, Rma, StockMovement, Supplier } from "@/lib/types";
import type { Store } from "@/lib/store/types";
import {
  adjustStock,
  buildAssembly,
  buildableQty,
  bulkPatchItems,
  consumptionReport,
  createItems,
  createOrder,
  createRma,
  deactivateItems,
  deadStockReport,
  deleteItems,
  explodeBom,
  findItem,
  fulfillOrder,
  inventoryValue,
  isLowStock,
  lowStockReport,
  receiveStock,
  resolveRma,
  seasonalityReport,
  shelfLifeReport,
  updateItem,
  upsertSupplier,
  whereUsed,
  whereUsedDeep,
  type Actor,
  type ItemPatch,
  InventoryError,
  backorderReport,
} from "@/lib/inventory";
import { matches, round } from "@/lib/utils";
import { crossRefText } from "@/lib/scan";
import { kpiReport } from "@/lib/kpis";
import type { AgentToolName } from "./tools";

export interface ExecContext {
  store: Store;
  actor: Actor;
}

type Filter = {
  query?: string;
  category?: string;
  type?: Item["type"];
  status?: Item["status"];
  supplier?: string;
  belowMin?: boolean;
  tags?: string[];
  location?: string;
  noMovementDays?: number;
};

function applyFilter(items: Item[], filter: Filter | undefined, suppliers: Supplier[], movements: StockMovement[]): Item[] {
  if (!filter) return items;
  let out = items;
  if (filter.query) out = out.filter((i) => matches(filter.query!, i.sku, i.name, i.description, i.category, i.tags.join(" "), i.location, i.barcode, crossRefText(i)));
  if (filter.category) out = out.filter((i) => (i.category ?? "").toLowerCase() === filter.category!.toLowerCase() || matches(filter.category!, i.category));
  if (filter.type) out = out.filter((i) => i.type === filter.type);
  if (filter.status) out = out.filter((i) => i.status === filter.status);
  if (filter.supplier) {
    const ids = new Set(suppliers.filter((s) => matches(filter.supplier!, s.name)).map((s) => s.id));
    out = out.filter((i) => i.supplierId && ids.has(i.supplierId));
  }
  if (filter.belowMin) out = out.filter(isLowStock);
  if (filter.tags?.length) out = out.filter((i) => filter.tags!.some((t) => i.tags.map((x) => x.toLowerCase()).includes(t.toLowerCase())));
  if (filter.location) out = out.filter((i) => matches(filter.location!, i.location));
  if (filter.noMovementDays) {
    const since = Date.now() - filter.noMovementDays * 86_400_000;
    const recent = new Set(movements.filter((m) => m.qty < 0 && new Date(m.occurredAt).getTime() >= since).map((m) => m.itemId));
    out = out.filter((i) => !recent.has(i.id));
  }
  return out;
}

function brief(i: Item, suppliers: Supplier[]) {
  return {
    sku: i.sku,
    name: i.name,
    type: i.type,
    category: i.category,
    status: i.status,
    onHand: i.onHand,
    unit: i.unit,
    minQty: i.minQty,
    maxQty: i.maxQty,
    unitCost: i.unitCost,
    price: i.price,
    salePrice: i.salePrice,
    leadTimeDays: i.leadTimeDays,
    supplier: suppliers.find((s) => s.id === i.supplierId)?.name,
    location: i.location,
    tags: i.tags.length ? i.tags : undefined,
    belowMin: isLowStock(i) || undefined,
  };
}

interface TargetInput {
  skus?: string[];
  filter?: Filter;
  /** Every active item. */
  all?: boolean;
  /** Per-item lines target their own SKUs. */
  lines?: Array<{ sku: string; set?: SetFields }>;
}

async function resolveTargets(ctx: ExecContext, input: TargetInput): Promise<Item[]> {
  const items = await ctx.store.list("items");
  const suppliers = await ctx.store.list("suppliers");
  const movements = await ctx.store.list("movements");
  const out = new Map<string, Item>();
  for (const s of [...(input.skus ?? []), ...(input.lines ?? []).map((l) => l.sku)]) {
    const it = findItem(items, s);
    if (!it) throw new InventoryError(`Unknown SKU ${s}`);
    out.set(it.id, it);
  }
  if (input.filter) {
    for (const it of applyFilter(items, input.filter, suppliers, movements)) out.set(it.id, it);
  }
  if (input.all) for (const it of items) if (it.status === "active") out.set(it.id, it);
  if (out.size === 0 && !input.filter && !input.all) throw new InventoryError("Provide skus, a filter, lines, or all: true");
  return Array.from(out.values());
}

async function resolveSupplierId(ctx: ExecContext, name?: string): Promise<string | undefined> {
  if (!name?.trim()) return undefined;
  const suppliers = await ctx.store.list("suppliers");
  const found = suppliers.find((s) => s.name.toLowerCase() === name.trim().toLowerCase()) ?? suppliers.find((s) => matches(name, s.name));
  if (found) return found.id;
  const created = await upsertSupplier(ctx.store, ctx.actor, { name: name.trim() });
  return created.id;
}

type SetFields = Record<string, unknown> & { supplierName?: string };

async function fieldsToPatch(ctx: ExecContext, set: SetFields | undefined): Promise<ItemPatch> {
  if (!set) return {};
  const { supplierName, ...rest } = set;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v === undefined) continue;
    patch[k] = v === null ? undefined : v;
  }
  if (supplierName) patch.supplierId = await resolveSupplierId(ctx, supplierName);
  return patch as ItemPatch;
}

function computeBulkPatch(item: Item, base: ItemPatch, input: { adjustPricePct?: number; adjustCostPct?: number; addTags?: string[]; removeTags?: string[] }): ItemPatch {
  const patch: ItemPatch = { ...base };
  if (input.adjustPricePct) patch.price = round(item.price * (1 + input.adjustPricePct / 100));
  if (input.adjustCostPct) patch.unitCost = round(item.unitCost * (1 + input.adjustCostPct / 100));
  if (input.addTags?.length || input.removeTags?.length) {
    const tags = new Set(item.tags);
    input.addTags?.forEach((t) => tags.add(t));
    input.removeTags?.forEach((t) => tags.delete(t));
    patch.tags = Array.from(tags);
  }
  return patch;
}

function diff(item: Item, patch: ItemPatch): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(patch)) {
    const from = (item as unknown as Record<string, unknown>)[k];
    if (JSON.stringify(from) !== JSON.stringify(v)) out[k] = { from, to: v };
  }
  return out;
}

type BulkInput = TargetInput & { set?: SetFields; adjustPricePct?: number; adjustCostPct?: number; addTags?: string[]; removeTags?: string[] };

interface BulkPlanRow {
  item: Item;
  changes: Record<string, { from: unknown; to: unknown }>;
}

/** Resolve one bulk update (targets, shared set, percentage adjustments, per-item lines) into per-item diffs. Side-effect free apart from supplier lookups. */
async function bulkPlan(ctx: ExecContext, input: BulkInput): Promise<BulkPlanRow[]> {
  const targets = await resolveTargets(ctx, input);
  const base = await fieldsToPatch(ctx, input.set);
  const perItem = new Map<string, ItemPatch>();
  if (input.lines?.length) {
    const items = await ctx.store.list("items");
    for (const l of input.lines) {
      const it = findItem(items, l.sku);
      if (!it) throw new InventoryError(`Unknown SKU ${l.sku}`);
      perItem.set(it.id, { ...(perItem.get(it.id) ?? {}), ...(await fieldsToPatch(ctx, l.set)) });
    }
  }
  return targets.map((item) => ({ item, changes: diff(item, { ...computeBulkPatch(item, base, input), ...(perItem.get(item.id) ?? {}) }) }));
}

function patchFromChanges(changes: BulkPlanRow["changes"]): ItemPatch {
  return Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to])) as ItemPatch;
}

// ---------------------------------------------------------------------------

export async function executeTool(name: AgentToolName, rawInput: unknown, ctx: ExecContext): Promise<unknown> {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const { store, actor } = ctx;

  switch (name) {
    case "getWorkspaceSummary": {
      const [items, suppliers, orders, rmas, settings, movements] = await Promise.all([store.list("items"), store.list("suppliers"), store.list("orders"), store.list("rmas"), store.list("settings"), store.list("movements")]);
      const cats: Record<string, { items: number; value: number }> = {};
      for (const i of items) {
        const c = i.category ?? "Uncategorised";
        cats[c] ??= { items: 0, value: 0 };
        cats[c].items++;
        cats[c].value = round(cats[c].value + i.onHand * i.unitCost);
      }
      const since30 = Date.now() - 30 * 86_400_000;
      const sold30 = movements.filter((m) => m.type === "sale" && new Date(m.occurredAt).getTime() >= since30).reduce((a, m) => a - m.qty, 0);
      return {
        company: settings[0]?.companyName,
        currency: settings[0]?.currency,
        relievePolicy: settings[0]?.relievePolicy,
        items: { total: items.length, active: items.filter((i) => i.status === "active").length, inactive: items.filter((i) => i.status === "inactive").length, superseded: items.filter((i) => i.status === "superseded").length, assemblies: items.filter((i) => i.type === "assembly").length },
        inventoryValue: inventoryValue(items),
        belowMin: items.filter(isLowStock).map((i) => i.sku),
        unitsSoldLast30Days: sold30,
        openOrders: orders.filter((o) => o.status === "open").map((o) => ({ number: o.number, customer: o.customer, lines: o.lines.length })),
        openRmas: rmas.filter((r) => r.status === "open" || r.status === "inspecting").map((r) => ({ number: r.number, customer: r.customer, reason: r.reason })),
        categories: cats,
        suppliers: suppliers.map((s) => ({ name: s.name, leadTimeDays: s.leadTimeDays, items: items.filter((i) => i.supplierId === s.id).length })),
      };
    }

    case "searchItems": {
      const [items, suppliers, movements] = await Promise.all([store.list("items"), store.list("suppliers"), store.list("movements")]);
      let rows = applyFilter(items, input.filter as Filter | undefined, suppliers, movements);
      const skus = input.skus as string[] | undefined;
      if (skus?.length) {
        const want = new Set(skus.map((s) => s.trim().toUpperCase()));
        rows = rows.filter((i) => want.has(i.sku.toUpperCase()));
      }
      const sortBy = input.sortBy as string | undefined;
      if (sortBy === "onHand") rows = [...rows].sort((a, b) => b.onHand - a.onHand);
      else if (sortBy === "value") rows = [...rows].sort((a, b) => b.onHand * b.unitCost - a.onHand * a.unitCost);
      else if (sortBy === "updatedAt") rows = [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      else if (sortBy === "name") rows = [...rows].sort((a, b) => a.name.localeCompare(b.name));
      else rows = [...rows].sort((a, b) => a.sku.localeCompare(b.sku));
      const limit = Math.min(200, Number(input.limit) || 50);
      return { total: rows.length, returned: Math.min(limit, rows.length), items: rows.slice(0, limit).map((i) => brief(i, suppliers)) };
    }

    case "getItem": {
      const [items, suppliers, movements, lots] = await Promise.all([store.list("items"), store.list("suppliers"), store.list("movements"), store.list("lots")]);
      const item = findItem(items, String(input.sku ?? ""));
      if (!item) throw new InventoryError(`Unknown SKU ${input.sku}`);
      const byId = new Map(items.map((i) => [i.id, i]));
      return {
        ...brief(item, suppliers),
        description: item.description,
        barcode: item.barcode,
        crossRefs: item.crossRefs?.map((r) => ({ number: r.number, kind: r.kind, source: r.source })),
        stockByLocation: item.stock ? Object.entries(item.stock).map(([locationId, s]) => ({ locationId, qty: s.qty, bin: s.bin })) : undefined,
        inTransit: item.inTransit || undefined,
        supersededBy: item.supersededBy ? byId.get(item.supersededBy)?.sku : undefined,
        priceBreaks: item.priceBreaks,
        expectedWastePct: item.expectedWastePct,
        bom: item.bom.map((l) => ({ sku: byId.get(l.itemId)?.sku, name: byId.get(l.itemId)?.name, qty: l.qty, wastePct: l.wastePct, onHand: byId.get(l.itemId)?.onHand })),
        buildable: item.type === "assembly" ? buildableQty(items, item) : undefined,
        whereUsed: whereUsed(items, item.id).map((w) => ({ sku: w.assembly.sku, name: w.assembly.name, qtyPer: w.qtyPer })),
        lotsOnShelf: lots.filter((l) => l.itemId === item.id && l.qtyRemaining > 0).map((l) => ({ receivedAt: l.receivedAt.slice(0, 10), qtyRemaining: l.qtyRemaining, unitCost: l.unitCost })),
        recentMovements: movements
          .filter((m) => m.itemId === item.id)
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
          .slice(0, 15)
          .map((m) => ({ date: m.occurredAt.slice(0, 10), type: m.type, qty: m.qty, balanceAfter: m.balanceAfter, reason: m.reason })),
      };
    }

    case "explodeBom": {
      const items = await store.list("items");
      const asm = findItem(items, String(input.sku ?? ""));
      if (!asm) throw new InventoryError(`Unknown SKU ${input.sku}`);
      const qty = Number(input.qty) || 1;
      const consume = input.consumeSubassemblies !== false;
      const reqs = explodeBom(items, asm, qty, { consumeSubassemblies: consume, explodeShortfallOnly: !consume });
      return {
        assembly: asm.sku,
        qty,
        buildableNow: buildableQty(items, asm),
        requirements: reqs.map((r) => ({ sku: r.item.sku, name: r.item.name, required: r.required, available: r.available, shortage: r.shortage, depth: r.depth })),
        shortages: reqs.filter((r) => r.shortage > 0).map((r) => r.item.sku),
      };
    }

    case "whereUsed": {
      const items = await store.list("items");
      const item = findItem(items, String(input.sku ?? ""));
      if (!item) throw new InventoryError(`Unknown SKU ${input.sku}`);
      return {
        sku: item.sku,
        direct: whereUsed(items, item.id).map((w) => ({ sku: w.assembly.sku, name: w.assembly.name, qtyPer: w.qtyPer, status: w.assembly.status })),
        allAncestors: whereUsedDeep(items, item.id).map((a) => a.sku),
      };
    }

    case "getReport": {
      const report = String(input.report);
      const limit = Math.min(200, Number(input.limit) || 50);
      const [items, suppliers, movements, lots, orders, rmas, activity, receipts, builds] = await Promise.all([
        store.list("items"), store.list("suppliers"), store.list("movements"), store.list("lots"), store.list("orders"), store.list("rmas"), store.list("activity"), store.list("receipts"), store.list("builds"),
      ]);
      const byId = new Map(items.map((i) => [i.id, i]));
      switch (report) {
        case "lowStock":
          return lowStockReport(items, suppliers, movements).slice(0, limit).map((r) => ({ sku: r.item.sku, name: r.item.name, onHand: r.item.onHand, min: r.item.minQty, max: r.item.maxQty, reorder: r.reorder, daysOfCover: r.daysOfCover, supplier: r.supplier?.name, leadTimeDays: r.item.leadTimeDays ?? r.supplier?.leadTimeDays, unitCost: r.item.unitCost }));
        case "valuation": {
          const cats: Record<string, { items: number; units: number; value: number }> = {};
          for (const i of items) {
            const c = i.category ?? "Uncategorised";
            cats[c] ??= { items: 0, units: 0, value: 0 };
            cats[c].items++;
            cats[c].units = round(cats[c].units + i.onHand);
            cats[c].value = round(cats[c].value + i.onHand * i.unitCost);
          }
          return { total: inventoryValue(items), byCategory: cats, topItems: [...items].sort((a, b) => b.onHand * b.unitCost - a.onHand * a.unitCost).slice(0, 15).map((i) => ({ sku: i.sku, onHand: i.onHand, unitCost: i.unitCost, value: round(i.onHand * i.unitCost) })) };
        }
        case "shelfLife":
          return shelfLifeReport(items, lots).slice(0, limit).map((r) => ({ sku: r.item.sku, name: r.item.name, onHand: r.item.onHand, oldestDays: r.oldestDays, avgAgeDays: r.avgAgeDays, lots: r.lots.map((l) => ({ receivedAt: l.receivedAt.slice(0, 10), remaining: l.qtyRemaining })) }));
        case "deadStock":
          return deadStockReport(items, movements, Number(input.days) || 120).slice(0, limit).map((r) => ({ sku: r.item.sku, name: r.item.name, onHand: r.item.onHand, value: round(r.item.onHand * r.item.unitCost), lastMovementAt: r.lastMovementAt?.slice(0, 10), usedInActiveBoms: r.usedIn }));
        case "consumption": {
          const rows = consumptionReport(items, movements, Number(input.days) || 90);
          const filtered = input.sku ? rows.filter((r) => r.item.sku.toUpperCase() === String(input.sku).toUpperCase()) : rows;
          return filtered.slice(0, limit).map((r) => ({ sku: r.item.sku, name: r.item.name, sold: r.sold, consumedInBuilds: r.consumedInBuilds, writtenOff: r.writtenOff, returned: r.returned, received: r.received, built: r.built, totalUsage: r.totalUsage, onHand: r.item.onHand }));
        }
        case "seasonality": {
          const item = input.sku ? findItem(items, String(input.sku)) : undefined;
          return seasonalityReport(movements, 12, item?.id);
        }
        case "openOrders":
          return orders.filter((o) => o.status === "open" || o.status === "partial").map((o) => ({ number: o.number, customer: o.customer, source: o.source, status: o.status, createdAt: o.createdAt.slice(0, 10), lines: o.lines.map((l) => ({ sku: byId.get(l.itemId)?.sku, qty: l.qty, shipped: l.shipped ?? 0, unitPrice: l.unitPrice, onHand: byId.get(l.itemId)?.onHand })) }));
        case "backorders":
          return backorderReport(orders, items, suppliers).slice(0, limit).map((r) => ({ order: r.order.number, customer: r.order.customer, sku: r.item?.sku, open: r.openQty, available: r.available, shortBy: r.shortBy, supplier: r.supplier?.name, couldShipBy: r.expectedAt?.slice(0, 10), ordered: r.order.createdAt.slice(0, 10) }));
        case "kpis": {
          const shipments = await store.list("shipments");
          const rep = kpiReport(items, movements, orders, shipments, { days: Number(input.days) || 90 });
          return { periodDays: rep.period.days, company: rep.company, byCategory: rep.byCategory.slice(0, limit) };
        }
        case "transfers": {
          const transfers = await store.list("transfers");
          const locations = await store.list("locations");
          const name = (id: string) => locations.find((l) => l.id === id)?.name ?? id;
          return [...transfers].sort((a, b) => b.shippedAt.localeCompare(a.shippedAt)).slice(0, limit).map((t) => ({ number: t.number, from: name(t.fromLocationId), to: name(t.toLocationId), status: t.status, sentAt: t.shippedAt.slice(0, 10), receivedAt: t.receivedAt?.slice(0, 10), lines: t.lines.map((l) => ({ sku: byId.get(l.itemId)?.sku, qty: l.qty, received: l.receivedQty })) }));
        }
        case "openRmas":
          return rmas.filter((r) => r.status === "open" || r.status === "inspecting").map((r) => ({ number: r.number, customer: r.customer, reason: r.reason, status: r.status, lines: r.lines.map((l) => ({ sku: byId.get(l.itemId)?.sku, qty: l.qty, condition: l.condition })) }));
        case "recentActivity":
          return [...activity].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((a) => ({ at: a.createdAt, message: a.message }));
        case "suppliers":
          return suppliers.map((s) => ({ name: s.name, email: s.email, leadTimeDays: s.leadTimeDays, terms: s.terms, items: items.filter((i) => i.supplierId === s.id).length }));
        case "recentReceipts":
          return [...receipts].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, limit).map((r) => ({ number: r.number, supplier: suppliers.find((s) => s.id === r.supplierId)?.name, reference: r.reference, receivedAt: r.receivedAt.slice(0, 10), lines: r.lines.map((l) => ({ sku: byId.get(l.itemId)?.sku, qty: l.qty, unitCost: l.unitCost })) }));
        case "recentBuilds":
          return [...builds].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map((b) => ({ number: b.number, assembly: byId.get(b.assemblyId)?.sku, qty: b.qty, completedAt: b.completedAt?.slice(0, 10) }));
        default:
          throw new InventoryError(`Unknown report ${report}`);
      }
    }

    case "previewBulkUpdate": {
      const plan = await bulkPlan(ctx, input as BulkInput);
      const changing = plan.filter((p) => Object.keys(p.changes).length > 0);
      return {
        matched: plan.length,
        wouldChange: changing.length,
        items: plan.slice(0, 50).map((p) => ({ sku: p.item.sku, name: p.item.name, changes: p.changes })),
        truncated: plan.length > 50 ? plan.length - 50 : 0,
      };
    }

    // ---- WRITE ---------------------------------------------------------------

    case "bulkUpdateItems": {
      const plan = await bulkPlan(ctx, input as BulkInput);
      if (plan.length === 0) return { ok: true, updated: 0, summary: "No items matched." };
      const changing = plan.filter((p) => Object.keys(p.changes).length > 0);
      const n = changing.length ? await bulkPatchItems(store, actor, changing.map((p) => ({ id: p.item.id, patch: patchFromChanges(p.changes) })), String(input.reason ?? "Agent bulk update")) : 0;
      return { ok: true, updated: n, unchanged: plan.length - changing.length, skus: changing.slice(0, 30).map((p) => p.item.sku), summary: `Updated ${n} item${n === 1 ? "" : "s"}` };
    }

    case "createItems": {
      const specs = (input.items as Array<Record<string, unknown>>) ?? [];
      const existing = await store.list("items");
      const prepared = [];
      for (const s of specs) {
        const supplierId = await resolveSupplierId(ctx, s.supplierName as string | undefined);
        prepared.push({
          sku: String(s.sku),
          name: String(s.name),
          type: (s.type as Item["type"]) ?? "part",
          category: s.category as string | undefined,
          description: s.description as string | undefined,
          unit: (s.unit as string) ?? "ea",
          unitCost: Number(s.unitCost ?? 0),
          price: Number(s.price ?? 0),
          minQty: s.minQty as number | undefined,
          maxQty: s.maxQty as number | undefined,
          leadTimeDays: s.leadTimeDays as number | undefined,
          location: s.location as string | undefined,
          supplierId,
          tags: (s.tags as string[]) ?? [],
          openingQty: s.openingQty as number | undefined,
          bom: ((s.bom as Array<{ sku: string; qty: number; wastePct?: number }>) ?? []).map((l) => {
            const comp = findItem(existing, l.sku);
            if (!comp) throw new InventoryError(`BOM component ${l.sku} not found`);
            return { itemId: comp.id, qty: l.qty, wastePct: l.wastePct };
          }),
        });
      }
      const created = await createItems(store, actor, prepared);
      return { ok: true, created: created.length, skus: created.map((c) => c.sku), summary: `Created ${created.length} item${created.length === 1 ? "" : "s"}` };
    }

    case "adjustStock": {
      const items = await store.list("items");
      const adjustments = (input.adjustments as Array<Record<string, unknown>>) ?? [];
      const mapped = adjustments.map((a) => {
        const item = findItem(items, String(a.sku));
        if (!item) throw new InventoryError(`Unknown SKU ${a.sku}`);
        return {
          itemId: item.id,
          qtyDelta: a.qtyDelta as number | undefined,
          newQty: a.newQty as number | undefined,
          type: a.type as "adjustment" | "count" | "write_off" | undefined,
          reason: (a.reason as string | undefined) ?? String(input.reason ?? ""),
          occurredAt: input.occurredAt as string | undefined,
          refType: "agent" as const,
        };
      });
      const moves = await adjustStock(store, actor, mapped);
      return { ok: true, movements: moves.length, changes: moves.map((m) => ({ sku: items.find((i) => i.id === m.itemId)?.sku, qty: m.qty, balanceAfter: m.balanceAfter, type: m.type })), summary: `Recorded ${moves.length} stock movement${moves.length === 1 ? "" : "s"}` };
    }

    case "receiveStock": {
      const items = await store.list("items");
      const supplierId = await resolveSupplierId(ctx, input.supplierName as string | undefined);
      const lines = ((input.lines as Array<Record<string, unknown>>) ?? []).map((l) => {
        const item = findItem(items, String(l.sku));
        if (!item) throw new InventoryError(`Unknown SKU ${l.sku}`);
        return { itemId: item.id, qty: Number(l.qty), unitCost: l.unitCost as number | undefined };
      });
      const receipt = await receiveStock(store, actor, { supplierId, reference: input.reference as string | undefined, receivedAt: input.receivedAt as string | undefined, note: input.note as string | undefined, lines });
      return { ok: true, receipt: receipt.number, lines: receipt.lines.length, summary: `Received ${receipt.number} with ${receipt.lines.length} line${receipt.lines.length === 1 ? "" : "s"}` };
    }

    case "buildAssembly": {
      const items = await store.list("items");
      const asm = findItem(items, String(input.sku ?? ""));
      if (!asm) throw new InventoryError(`Unknown SKU ${input.sku}`);
      const build = await buildAssembly(store, actor, { assemblyId: asm.id, qty: Number(input.qty), consumeSubassemblies: input.consumeSubassemblies as boolean | undefined, note: input.note as string | undefined });
      return { ok: true, build: build.number, qty: build.qty, componentsConsumed: build.components.length, summary: `Built ${build.qty} × ${asm.sku} (${build.number})` };
    }

    case "updateBom": {
      const items = await store.list("items");
      const asm = findItem(items, String(input.sku ?? ""));
      if (!asm) throw new InventoryError(`Unknown SKU ${input.sku}`);
      const mode = (input.mode as string) ?? "merge";
      const lines = (input.lines as Array<{ sku: string; qty?: number; wastePct?: number }>) ?? [];
      const ancestors = new Set(whereUsedDeep(items, asm.id).map((a) => a.id));
      let bom = [...asm.bom];
      for (const l of lines) {
        const comp = findItem(items, l.sku);
        if (!comp) throw new InventoryError(`Unknown component ${l.sku}`);
        if (comp.id === asm.id) throw new InventoryError("An assembly cannot contain itself");
        if (ancestors.has(comp.id)) throw new InventoryError(`${comp.sku} already uses ${asm.sku} (directly or through a sub-assembly); adding it would create a BOM loop`);
        if (mode === "remove") {
          bom = bom.filter((b) => b.itemId !== comp.id);
        } else {
          const idx = bom.findIndex((b) => b.itemId === comp.id);
          const line = { itemId: comp.id, qty: l.qty ?? bom[idx]?.qty ?? 1, wastePct: l.wastePct ?? bom[idx]?.wastePct };
          if (idx >= 0) bom[idx] = line;
          else bom.push(line);
        }
      }
      if (mode === "replace") {
        bom = lines.map((l) => {
          const comp = findItem(items, l.sku)!;
          return { itemId: comp.id, qty: l.qty ?? 1, wastePct: l.wastePct };
        });
      }
      await updateItem(store, actor, asm.id, { bom, type: "assembly" }, String(input.reason ?? "BOM updated by agent"));
      return { ok: true, sku: asm.sku, lines: bom.length, summary: `${asm.sku} BOM now has ${bom.length} line${bom.length === 1 ? "" : "s"}` };
    }

    case "deactivateItems": {
      const targets = await resolveTargets(ctx, input as { skus?: string[]; filter?: Filter });
      const items = await store.list("items");
      const sup = input.supersededBySku ? findItem(items, String(input.supersededBySku)) : undefined;
      if (input.supersededBySku && !sup) throw new InventoryError(`Unknown SKU ${input.supersededBySku}`);
      const n = await deactivateItems(store, actor, targets.map((t) => t.id), { supersededBy: sup?.id, reason: String(input.reason ?? "") });
      return { ok: true, updated: n, skus: targets.map((t) => t.sku), summary: `${sup ? "Superseded" : "Deactivated"} ${n} item${n === 1 ? "" : "s"}` };
    }

    case "createOrder": {
      const items = await store.list("items");
      const lines = ((input.lines as Array<Record<string, unknown>>) ?? []).map((l) => {
        const item = findItem(items, String(l.sku));
        if (!item) throw new InventoryError(`Unknown SKU ${l.sku}`);
        return { itemId: item.id, qty: Number(l.qty), unitPrice: l.unitPrice as number | undefined };
      });
      const order = await createOrder(store, actor, { customer: String(input.customer ?? ""), lines, fulfill: Boolean(input.fulfill), note: input.note as string | undefined });
      return { ok: true, order: order.number, status: order.status, summary: `${order.status === "fulfilled" ? "Created and shipped" : "Created"} ${order.number}` };
    }

    case "fulfillOrders": {
      const orders = await store.list("orders");
      const numbers = (input.orderNumbers as string[]) ?? [];
      const done: string[] = [];
      const failed: Array<{ number: string; error: string }> = [];
      for (const n of numbers) {
        const o = orders.find((x) => x.number.toUpperCase() === n.toUpperCase());
        if (!o) {
          failed.push({ number: n, error: "not found" });
          continue;
        }
        try {
          await fulfillOrder(store, actor, o.id);
          done.push(o.number);
        } catch (e) {
          failed.push({ number: n, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return { ok: failed.length === 0, fulfilled: done, failed, summary: `Shipped ${done.length} order${done.length === 1 ? "" : "s"}${failed.length ? `, ${failed.length} failed` : ""}` };
    }

    case "createRma": {
      const items = await store.list("items");
      const lines = ((input.lines as Array<Record<string, unknown>>) ?? []).map((l) => {
        const item = findItem(items, String(l.sku));
        if (!item) throw new InventoryError(`Unknown SKU ${l.sku}`);
        return { itemId: item.id, qty: Number(l.qty), condition: l.condition as Rma["lines"][number]["condition"] | undefined };
      });
      const rma = await createRma(store, actor, { customer: String(input.customer ?? ""), reason: String(input.reason ?? ""), reference: input.reference as string | undefined, lines });
      return { ok: true, rma: rma.number, summary: `Opened ${rma.number}` };
    }

    case "resolveRma": {
      const [rmas, items] = await Promise.all([store.list("rmas"), store.list("items")]);
      const rma = rmas.find((r) => r.number.toUpperCase() === String(input.rmaNumber).toUpperCase());
      if (!rma) throw new InventoryError(`Unknown RMA ${input.rmaNumber}`);
      const dispositions = ((input.dispositions as Array<Record<string, unknown>>) ?? []).map((d) => {
        const item = findItem(items, String(d.sku));
        if (!item) throw new InventoryError(`Unknown SKU ${d.sku}`);
        return { itemId: item.id, disposition: d.disposition as "restock" | "refund" | "scrap" };
      });
      const resolved = await resolveRma(store, actor, rma.id, dispositions, input.note as string | undefined);
      return { ok: true, rma: resolved.number, status: resolved.status, summary: `${resolved.number} resolved as ${resolved.status}` };
    }

    case "upsertSupplier": {
      const suppliers = await store.list("suppliers");
      const existing = suppliers.find((s) => s.name.toLowerCase() === String(input.name).toLowerCase());
      const saved = await upsertSupplier(store, actor, { ...(existing ?? {}), ...(input as Partial<Supplier>), name: String(input.name) });
      return { ok: true, supplier: saved.name, created: !existing, summary: `${existing ? "Updated" : "Created"} supplier ${saved.name}` };
    }

    case "deleteItems": {
      const items = await store.list("items");
      const targets = ((input.skus as string[]) ?? []).map((s) => {
        const it = findItem(items, s);
        if (!it) throw new InventoryError(`Unknown SKU ${s}`);
        return it;
      });
      await deleteItems(store, actor, targets.map((t) => t.id));
      return { ok: true, deleted: targets.map((t) => t.sku), summary: `Deleted ${targets.length} item${targets.length === 1 ? "" : "s"}` };
    }

    default:
      throw new InventoryError(`Unknown tool ${name as string}`);
  }
}

/** Tools whose effect can be overlaid on the item tables before applying. */
export const PREVIEWABLE_TOOLS: AgentToolName[] = ["bulkUpdateItems", "deactivateItems", "adjustStock", "receiveStock", "updateBom"];

/**
 * Side-effect-free: the per-item field patches a write tool would apply, so
 * the app can overlay them on tables as a live preview.
 */
export async function previewPatches(name: AgentToolName, rawInput: unknown, ctx: ExecContext): Promise<Record<string, Partial<Item>>> {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const items = await ctx.store.list("items");
  const out: Record<string, Partial<Item>> = {};
  switch (name) {
    case "bulkUpdateItems": {
      for (const p of await bulkPlan(ctx, input as BulkInput)) if (Object.keys(p.changes).length) out[p.item.id] = patchFromChanges(p.changes) as Partial<Item>;
      return out;
    }
    case "deactivateItems": {
      const targets = await resolveTargets(ctx, input as TargetInput);
      const base = { status: input.supersededBySku ? "superseded" : "inactive" } as ItemPatch;
      for (const it of targets) {
        const changes = diff(it, base);
        if (Object.keys(changes).length) out[it.id] = patchFromChanges(changes) as Partial<Item>;
      }
      return out;
    }
    case "adjustStock": {
      for (const a of (input.adjustments as Array<Record<string, unknown>>) ?? []) {
        const it = findItem(items, String(a.sku));
        if (!it) continue;
        const next = a.newQty !== undefined ? Number(a.newQty) : it.onHand + Number(a.qtyDelta ?? 0);
        if (Number.isFinite(next) && next !== it.onHand) out[it.id] = { onHand: round(next, 3) };
      }
      return out;
    }
    case "receiveStock": {
      for (const l of (input.lines as Array<Record<string, unknown>>) ?? []) {
        const it = findItem(items, String(l.sku));
        if (!it) continue;
        const prev = out[it.id]?.onHand ?? it.onHand;
        out[it.id] = { ...(out[it.id] ?? {}), onHand: round(prev + Number(l.qty ?? 0), 3), ...(l.unitCost !== undefined ? { unitCost: Number(l.unitCost) } : {}) };
      }
      return out;
    }
    case "updateBom": {
      const asm = findItem(items, String(input.sku ?? ""));
      if (!asm) return out;
      const mode = (input.mode as string) ?? "merge";
      const lines = (input.lines as Array<{ sku: string; qty?: number; wastePct?: number }>) ?? [];
      let bom = [...asm.bom];
      for (const l of lines) {
        const comp = findItem(items, l.sku);
        if (!comp) continue;
        if (mode === "remove") bom = bom.filter((b) => b.itemId !== comp.id);
        else {
          const idx = bom.findIndex((b) => b.itemId === comp.id);
          const line = { itemId: comp.id, qty: l.qty ?? bom[idx]?.qty ?? 1, wastePct: l.wastePct ?? bom[idx]?.wastePct };
          if (idx >= 0) bom[idx] = line;
          else bom.push(line);
        }
      }
      if (mode === "replace") bom = lines.map((l) => ({ itemId: findItem(items, l.sku)?.id ?? "", qty: l.qty ?? 1, wastePct: l.wastePct })).filter((b) => b.itemId);
      out[asm.id] = { bom, type: "assembly" };
      return out;
    }
    default:
      return out;
  }
}

/** Side-effect-free description of what a write tool would do, for proposal cards. */
export async function describeProposal(name: AgentToolName, rawInput: unknown, ctx: ExecContext): Promise<{ title: string; lines: string[]; affected?: Array<{ sku: string; name: string; changes?: Record<string, { from: unknown; to: unknown }> }> }> {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const items = await ctx.store.list("items");
  const skuOf = (s: unknown) => findItem(items, String(s ?? ""))?.sku ?? String(s);
  try {
    switch (name) {
      case "bulkUpdateItems": {
        const plan = await bulkPlan(ctx, input as BulkInput);
        const changing = plan.filter((p) => Object.keys(p.changes).length > 0);
        const fields = Array.from(new Set(changing.flatMap((p) => Object.keys(p.changes))));
        const lineCount = Array.isArray(input.lines) ? input.lines.length : 0;
        const pct = (v: unknown) => `${Number(v) > 0 ? "+" : ""}${Number(v)}%`;
        const how = [
          input.adjustPricePct ? `Price ${pct(input.adjustPricePct)}` : null,
          input.adjustCostPct ? `Unit cost ${pct(input.adjustCostPct)}` : null,
          lineCount ? `${lineCount} per-item value${lineCount === 1 ? "" : "s"}` : null,
          plan.length > changing.length ? `${plan.length - changing.length} matched item${plan.length - changing.length === 1 ? " is" : "s are"} already up to date` : null,
        ].filter((s): s is string => Boolean(s));
        return {
          title: `Update ${changing.length} item${changing.length === 1 ? "" : "s"}`,
          lines: [fields.length ? `Fields: ${fields.join(", ")}` : "No field changes", ...how, ...(input.reason ? [`Reason: ${input.reason}`] : [])],
          affected: changing.slice(0, 40).map((p) => ({ sku: p.item.sku, name: p.item.name, changes: p.changes })),
        };
      }
      case "deactivateItems": {
        const targets = await resolveTargets(ctx, input as TargetInput);
        const base = { status: input.supersededBySku ? "superseded" : "inactive" } as ItemPatch;
        const affected = targets.slice(0, 40).map((i) => ({ sku: i.sku, name: i.name, changes: diff(i, base) }));
        return { title: `Deactivate ${targets.length} item${targets.length === 1 ? "" : "s"}`, lines: input.reason ? [`Reason: ${input.reason}`] : [], affected };
      }
      case "createItems": {
        const specs = (input.items as Array<Record<string, unknown>>) ?? [];
        return { title: `Create ${specs.length} item${specs.length === 1 ? "" : "s"}`, lines: specs.slice(0, 20).map((s) => `${s.sku} · ${s.name}${s.openingQty ? ` · opening ${s.openingQty}` : ""}`) };
      }
      case "adjustStock": {
        const adj = (input.adjustments as Array<Record<string, unknown>>) ?? [];
        return { title: `Adjust stock on ${adj.length} item${adj.length === 1 ? "" : "s"}`, lines: adj.slice(0, 20).map((a) => `${skuOf(a.sku)}: ${a.newQty !== undefined ? `set to ${a.newQty}` : `${Number(a.qtyDelta) > 0 ? "+" : ""}${a.qtyDelta}`}${a.type ? ` (${a.type})` : ""}`), affected: undefined };
      }
      case "receiveStock": {
        const lines = (input.lines as Array<Record<string, unknown>>) ?? [];
        return { title: `Receive ${lines.length} line${lines.length === 1 ? "" : "s"}${input.supplierName ? ` from ${input.supplierName}` : ""}`, lines: lines.slice(0, 20).map((l) => `${skuOf(l.sku)} × ${l.qty}${l.unitCost !== undefined ? ` @ ${l.unitCost}` : ""}`) };
      }
      case "buildAssembly":
        return { title: `Build ${input.qty} × ${skuOf(input.sku)}`, lines: [input.consumeSubassemblies === false ? "Explode sub-assemblies to base parts" : "Pull sub-assemblies from stock"] };
      case "updateBom": {
        const lines = (input.lines as Array<Record<string, unknown>>) ?? [];
        return { title: `Update BOM for ${skuOf(input.sku)} (${input.mode ?? "merge"})`, lines: lines.map((l) => `${skuOf(l.sku)}${l.qty !== undefined ? ` × ${l.qty}` : ""}`) };
      }
      case "createOrder": {
        const lines = (input.lines as Array<Record<string, unknown>>) ?? [];
        return { title: `Create order for ${input.customer}${input.fulfill ? " and ship" : ""}`, lines: lines.map((l) => `${skuOf(l.sku)} × ${l.qty}`) };
      }
      case "fulfillOrders":
        return { title: `Ship ${(input.orderNumbers as string[])?.length ?? 0} order(s)`, lines: (input.orderNumbers as string[]) ?? [] };
      case "createRma": {
        const lines = (input.lines as Array<Record<string, unknown>>) ?? [];
        return { title: `Open RMA for ${input.customer}`, lines: [String(input.reason ?? ""), ...lines.map((l) => `${skuOf(l.sku)} × ${l.qty}`)] };
      }
      case "resolveRma":
        return { title: `Resolve ${input.rmaNumber}`, lines: ((input.dispositions as Array<Record<string, unknown>>) ?? []).map((d) => `${skuOf(d.sku)}: ${d.disposition}`) };
      case "upsertSupplier":
        return { title: `Save supplier ${input.name}`, lines: Object.entries(input).filter(([k, v]) => k !== "name" && v !== undefined).map(([k, v]) => `${k}: ${v}`) };
      case "deleteItems":
        return { title: `Delete ${(input.skus as string[])?.length ?? 0} item(s) permanently`, lines: (input.skus as string[]) ?? [] };
      default:
        return { title: name, lines: [] };
    }
  } catch (e) {
    return { title: name, lines: [e instanceof Error ? e.message : String(e)] };
  }
}
