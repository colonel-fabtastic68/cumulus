/**
 * Inventory services. Every quantity change goes through `applyMovements`
 * so the ledger is the single source of truth ("bad data in = bad data out").
 *
 * Functions that take a `Store` mutate data; the rest are pure and work on
 * arrays so they can be used in the UI, in reports and by Nimbus alike.
 */
import type {
  ActivityEvent,
  ActivityType,
  Address,
  Build,
  IntegrationId,
  Item,
  ItemStock,
  Location,
  Lot,
  Member,
  MovementType,
  OrderLine,
  Receipt,
  RefType,
  Rma,
  RmaDisposition,
  SalesOrder,
  Shipment,
  ShipmentLine,
  ShipmentProvider,
  StockMovement,
  Supplier,
  Transfer,
  WorkspaceSettings,
} from "@/lib/types";
import type { Store, WriteOp } from "@/lib/store/types";
import { daysBetween, newId, nowIso, round, sum } from "@/lib/utils";
import { seedSettings } from "@/lib/seed";

export type Actor = Pick<Member, "id" | "name">;

export class InventoryError extends Error {
  constructor(
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "InventoryError";
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function itemDefaults(partial: Partial<Item> & { sku: string; name: string }): Item {
  const now = nowIso();
  return {
    id: partial.id ?? newId("itm"),
    sku: partial.sku.trim().toUpperCase(),
    name: partial.name.trim(),
    description: partial.description,
    type: partial.type ?? "part",
    category: partial.category?.trim() || undefined,
    tags: partial.tags ?? [],
    unit: partial.unit || "ea",
    status: partial.status ?? "active",
    supersededBy: partial.supersededBy,
    onHand: partial.onHand ?? 0,
    inUse: partial.inUse ?? 0,
    minQty: partial.minQty,
    maxQty: partial.maxQty,
    leadTimeDays: partial.leadTimeDays,
    unitCost: partial.unitCost ?? 0,
    price: partial.price ?? 0,
    salePrice: partial.salePrice,
    priceBreaks: partial.priceBreaks,
    supplierId: partial.supplierId,
    supplierSku: partial.supplierSku,
    location: partial.location,
    barcode: partial.barcode,
    expectedWastePct: partial.expectedWastePct,
    bom: partial.bom ?? [],
    externalIds: partial.externalIds,
    brand: partial.brand,
    weight: partial.weight,
    weightUnit: partial.weightUnit,
    dimensions: partial.dimensions,
    imageUrl: partial.imageUrl,
    attributes: partial.attributes,
    createdAt: partial.createdAt ?? now,
    updatedAt: now,
    updatedBy: partial.updatedBy,
  };
}

export function findItem(items: Item[], skuOrId: string): Item | undefined {
  const key = skuOrId.trim();
  return items.find((i) => i.id === key) ?? items.find((i) => i.sku.toUpperCase() === key.toUpperCase());
}

export function isLowStock(item: Item): boolean {
  return item.status === "active" && item.minQty !== undefined && item.onHand < item.minQty;
}

export function reorderQty(item: Item): number {
  if (item.maxQty === undefined) return item.minQty !== undefined ? Math.max(0, item.minQty * 2 - item.onHand) : 0;
  return Math.max(0, item.maxQty - item.onHand);
}

export function inventoryValue(items: Item[]): number {
  return round(sum(items.map((i) => i.onHand * i.unitCost)));
}

/** Effective unit price for a quantity, honouring sale price and quantity breaks. */
export function priceForQty(item: Item, qty: number): number {
  let price = item.salePrice !== undefined && item.salePrice < item.price ? item.salePrice : item.price;
  for (const b of [...(item.priceBreaks ?? [])].sort((a, b) => a.minQty - b.minQty)) {
    if (qty >= b.minQty) price = Math.min(price, b.price);
  }
  return price;
}

export function marginPct(item: Item, price = item.price): number {
  if (!price) return 0;
  return round(((price - item.unitCost) / price) * 100, 1);
}

/** Direct parents: assemblies whose BOM contains the item. */
export function whereUsed(items: Item[], itemId: string): Array<{ assembly: Item; qtyPer: number }> {
  const out: Array<{ assembly: Item; qtyPer: number }> = [];
  for (const it of items) {
    for (const line of it.bom) {
      if (line.itemId === itemId) out.push({ assembly: it, qtyPer: line.qty });
    }
  }
  return out;
}

/** All ancestors, deepest last. */
export function whereUsedDeep(items: Item[], itemId: string, seen = new Set<string>()): Item[] {
  const out: Item[] = [];
  for (const { assembly } of whereUsed(items, itemId)) {
    if (seen.has(assembly.id)) continue;
    seen.add(assembly.id);
    out.push(assembly, ...whereUsedDeep(items, assembly.id, seen));
  }
  return out;
}

export interface Requirement {
  item: Item;
  /** Quantity required including waste. */
  required: number;
  available: number;
  shortage: number;
  /** Nesting depth in the BOM tree (0 = direct component). */
  depth: number;
}

export interface ExplodeOptions {
  /** When true, sub-assemblies are taken from their own stock instead of being exploded. */
  consumeSubassemblies?: boolean;
  /** Explode sub-assemblies only when their stock is insufficient. */
  explodeShortfallOnly?: boolean;
}

/**
 * Explode a BOM into component requirements for building `qty` of `assembly`.
 * Handles BOMs within BOMs (factor 2d/20).
 */
export function explodeBom(items: Item[], assembly: Item, qty: number, opts: ExplodeOptions = {}): Requirement[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const acc = new Map<string, Requirement>();
  const visit = (asm: Item, mult: number, depth: number, path: Set<string>) => {
    for (const line of asm.bom) {
      const comp = byId.get(line.itemId);
      if (!comp) continue;
      const need = round(line.qty * mult * (1 + (line.wastePct ?? comp.expectedWastePct ?? 0) / 100), 3);
      const isSub = comp.type === "assembly" && comp.bom.length > 0 && !path.has(comp.id);
      if (isSub && !opts.consumeSubassemblies) {
        if (opts.explodeShortfallOnly) {
          const already = acc.get(comp.id)?.required ?? 0;
          const fromStock = Math.max(0, Math.min(need, comp.onHand - already));
          if (fromStock > 0) add(comp, fromStock, depth);
          const remainder = need - fromStock;
          if (remainder > 0) visit(comp, remainder, depth + 1, new Set([...path, comp.id]));
        } else {
          visit(comp, need, depth + 1, new Set([...path, comp.id]));
        }
      } else {
        add(comp, need, depth);
      }
    }
  };
  const add = (comp: Item, need: number, depth: number) => {
    const existing = acc.get(comp.id);
    const required = round((existing?.required ?? 0) + need, 3);
    acc.set(comp.id, {
      item: comp,
      required,
      available: comp.onHand,
      shortage: round(Math.max(0, required - comp.onHand), 3),
      depth: Math.min(existing?.depth ?? depth, depth),
    });
  };
  visit(assembly, qty, 0, new Set([assembly.id]));
  return Array.from(acc.values());
}

/** How many of an assembly can be built from stock right now (one level). */
export function buildableQty(items: Item[], assembly: Item, opts: ExplodeOptions = { consumeSubassemblies: true }): number {
  if (assembly.bom.length === 0) return 0;
  const one = explodeBom(items, assembly, 1, opts);
  let max = Infinity;
  for (const r of one) {
    if (r.required <= 0) continue;
    max = Math.min(max, Math.floor(r.available / r.required));
  }
  return Number.isFinite(max) ? Math.max(0, max) : 0;
}

/** Rolled-up cost of an assembly from its BOM. */
export function rolledUpCost(items: Item[], assembly: Item, depth = 0): number {
  if (assembly.type !== "assembly" || assembly.bom.length === 0 || depth > 8) return assembly.unitCost;
  const byId = new Map(items.map((i) => [i.id, i]));
  let total = 0;
  for (const line of assembly.bom) {
    const comp = byId.get(line.itemId);
    if (!comp) continue;
    total += rolledUpCost(items, comp, depth + 1) * line.qty * (1 + (line.wastePct ?? 0) / 100);
  }
  return round(total);
}

// ---------------------------------------------------------------------------
// Reports (pure)
// ---------------------------------------------------------------------------

export interface LowStockRow {
  item: Item;
  supplier?: Supplier;
  shortfall: number;
  reorder: number;
  /** Estimated days of cover at recent consumption rate. */
  daysOfCover: number | null;
}

export function lowStockReport(items: Item[], suppliers: Supplier[], movements: StockMovement[]): LowStockRow[] {
  const rates = consumptionRate(movements, 90);
  return items
    .filter(isLowStock)
    .map((item) => {
      const rate = rates.get(item.id) ?? 0;
      return {
        item,
        supplier: suppliers.find((s) => s.id === item.supplierId),
        shortfall: round((item.minQty ?? 0) - item.onHand, 2),
        reorder: round(reorderQty(item), 2),
        daysOfCover: rate > 0 ? Math.floor(item.onHand / rate) : null,
      };
    })
    .sort((a, b) => (a.daysOfCover ?? 9999) - (b.daysOfCover ?? 9999));
}

/** Average units consumed per day over the window, per item. */
export function consumptionRate(movements: StockMovement[], days: number): Map<string, number> {
  const since = Date.now() - days * 86_400_000;
  const totals = new Map<string, number>();
  for (const m of movements) {
    if (m.qty >= 0) continue;
    if (m.type !== "sale" && m.type !== "build_consume") continue;
    if (new Date(m.occurredAt).getTime() < since) continue;
    totals.set(m.itemId, (totals.get(m.itemId) ?? 0) + -m.qty);
  }
  const out = new Map<string, number>();
  for (const [id, t] of totals) out.set(id, t / days);
  return out;
}

export interface ConsumptionRow {
  item: Item;
  sold: number;
  consumedInBuilds: number;
  writtenOff: number;
  returned: number;
  received: number;
  built: number;
  /** sold + consumed + writtenOff (returns netted out). */
  totalUsage: number;
}

/** Factor 4/18: usage by layer — component sales vs BOM consumption vs waste. */
export function consumptionReport(items: Item[], movements: StockMovement[], days: number): ConsumptionRow[] {
  const since = Date.now() - days * 86_400_000;
  const rows = new Map<string, ConsumptionRow>();
  const get = (item: Item) => {
    let r = rows.get(item.id);
    if (!r) {
      r = { item, sold: 0, consumedInBuilds: 0, writtenOff: 0, returned: 0, received: 0, built: 0, totalUsage: 0 };
      rows.set(item.id, r);
    }
    return r;
  };
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const m of movements) {
    if (new Date(m.occurredAt).getTime() < since) continue;
    const item = byId.get(m.itemId);
    if (!item) continue;
    const r = get(item);
    const q = Math.abs(m.qty);
    switch (m.type) {
      case "sale": r.sold += q; break;
      case "build_consume": r.consumedInBuilds += q; break;
      case "write_off": r.writtenOff += q; break;
      case "rma_return": r.returned += q; break;
      case "receipt": r.received += q; break;
      case "build_produce": r.built += q; break;
      case "adjustment":
      case "count":
        if (m.qty < 0) r.writtenOff += q; break;
      default: break;
    }
  }
  for (const r of rows.values()) r.totalUsage = round(r.sold + r.consumedInBuilds + r.writtenOff - r.returned, 2);
  return Array.from(rows.values()).sort((a, b) => b.totalUsage - a.totalUsage);
}

export interface ShelfLifeRow {
  item: Item;
  /** Oldest batch still on the shelf, in days. */
  oldestDays: number;
  /** Weighted average age of remaining stock, in days. */
  avgAgeDays: number;
  remainingLots: number;
  lots: Lot[];
}

/** Factor 10: how long stock has been sitting, per batch and averaged. */
export function shelfLifeReport(items: Item[], lots: Lot[]): ShelfLifeRow[] {
  const byItem = new Map<string, Lot[]>();
  for (const l of lots) {
    if (l.qtyRemaining <= 0) continue;
    (byItem.get(l.itemId) ?? byItem.set(l.itemId, []).get(l.itemId)!).push(l);
  }
  const out: ShelfLifeRow[] = [];
  for (const item of items) {
    const ls = byItem.get(item.id);
    if (!ls || ls.length === 0 || item.onHand <= 0) continue;
    const ages = ls.map((l) => ({ age: daysBetween(l.receivedAt), qty: l.qtyRemaining }));
    const totalQty = sum(ages.map((a) => a.qty));
    out.push({
      item,
      oldestDays: Math.max(...ages.map((a) => a.age)),
      avgAgeDays: totalQty > 0 ? Math.round(sum(ages.map((a) => a.age * a.qty)) / totalQty) : 0,
      remainingLots: ls.length,
      lots: ls.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)),
    });
  }
  return out.sort((a, b) => b.oldestDays - a.oldestDays);
}

/** Factor 16: active items with no consumption in `days`, not used in any active BOM. */
export function deadStockReport(items: Item[], movements: StockMovement[], days: number): Array<{ item: Item; lastMovementAt?: string; usedIn: number }> {
  const since = Date.now() - days * 86_400_000;
  const last = new Map<string, string>();
  const recent = new Set<string>();
  for (const m of movements) {
    const t = new Date(m.occurredAt).getTime();
    const prev = last.get(m.itemId);
    if (!prev || prev < m.occurredAt) last.set(m.itemId, m.occurredAt);
    if (t >= since && m.qty < 0) recent.add(m.itemId);
  }
  return items
    .filter((i) => i.status === "active" && !recent.has(i.id))
    .map((item) => ({
      item,
      lastMovementAt: last.get(item.id),
      usedIn: whereUsed(items, item.id).filter((w) => w.assembly.status === "active").length,
    }))
    .sort((a, b) => (a.lastMovementAt ?? "").localeCompare(b.lastMovementAt ?? ""));
}

/** Factor 17: monthly consumption totals for a loose seasonality view. */
export function seasonalityReport(movements: StockMovement[], months = 12, itemId?: string): Array<{ month: string; sold: number; consumed: number }> {
  const out = new Map<string, { month: string; sold: number; consumed: number }>();
  const now = new Date();
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.set(key, { month: key, sold: 0, consumed: 0 });
  }
  for (const m of movements) {
    if (itemId && m.itemId !== itemId) continue;
    const key = m.occurredAt.slice(0, 7);
    const row = out.get(key);
    if (!row) continue;
    if (m.type === "sale") row.sold += -m.qty;
    else if (m.type === "build_consume") row.consumed += -m.qty;
  }
  return Array.from(out.values());
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

async function loadSettings(store: Store): Promise<WorkspaceSettings> {
  return (await store.get("settings", "default")) ?? seedSettings();
}

export async function nextNumber(store: Store, kind: keyof WorkspaceSettings["counters"]): Promise<{ number: string; ops: WriteOp[] }> {
  const settings = await loadSettings(store);
  const n = settings.counters[kind] ?? 1001;
  const prefix = { receipt: "RCV", build: "BLD", order: "SO", rma: "RMA", transfer: "TR", shipment: "SH", quote: "QT" }[kind];
  const ops: WriteOp[] = [
    { op: "patch", collection: "settings", id: "default", patch: { counters: { ...settings.counters, [kind]: n + 1 }, updatedAt: nowIso() } },
  ];
  return { number: `${prefix}-${n}`, ops };
}

export function activityOp(actor: Actor, type: ActivityType, message: string, extra: Partial<ActivityEvent> = {}): WriteOp {
  const ev: ActivityEvent = {
    id: newId("act"),
    type,
    message,
    actorId: actor.id,
    actorName: actor.name,
    createdAt: nowIso(),
    ...extra,
  };
  return { op: "put", collection: "activity", doc: ev };
}

export interface MovementInput {
  itemId: string;
  type: MovementType;
  qty: number;
  unitCost?: number;
  lotId?: string;
  refType?: RefType;
  refId?: string;
  reason?: string;
  note?: string;
  occurredAt?: string;
  /** Location the stock moves in or out of. Defaults to the workspace's default location. */
  locationId?: string;
}

/** Id of the location created on first use when a workspace has none. */
export const DEFAULT_LOCATION_ID = "loc_main";

/**
 * The location stock goes to when none is named: the one flagged default, else
 * the first active one. When a workspace has no locations yet, "Main" is
 * created on the spot so every movement has a home.
 */
export function defaultLocation(locations: Location[]): { location: Location; created: boolean } {
  const active = locations.filter((l) => l.active);
  const found = active.find((l) => l.isDefault) ?? active[0] ?? locations[0];
  if (found) return { location: found, created: false };
  return { location: { id: DEFAULT_LOCATION_ID, name: "Main", kind: "warehouse", isDefault: true, active: true, createdAt: nowIso() }, created: true };
}

/** Per-location balances for an item. Items that pre-date locations keep everything in the default location. */
export function stockMap(item: Item, homeId: string): Record<string, ItemStock> {
  if (item.stock) return { ...item.stock };
  const entry: ItemStock = { qty: item.onHand };
  if (item.location) entry.bin = item.location;
  return { [homeId]: entry };
}

/** Quantity of an item at one location. */
export function qtyAt(item: Item, locationId: string, homeId: string): number {
  if (item.stock) return item.stock[locationId]?.qty ?? 0;
  return locationId === homeId ? item.onHand : 0;
}

/**
 * Build the write ops for a set of movements. Does not commit — callers
 * compose these with their own document ops and commit once.
 */
export async function movementOps(
  store: Store,
  actor: Actor,
  inputs: MovementInput[],
  opts: { allowNegative?: boolean } = {},
): Promise<{ ops: WriteOp[]; movements: StockMovement[]; itemPatches: Map<string, Partial<Item>>; homeId: string }> {
  const items = await store.list("items");
  const lots = await store.list("lots");
  const locations = await store.list("locations");
  const byId = new Map(items.map((i) => [i.id, { ...i }]));
  const lotById = new Map(lots.map((l) => [l.id, { ...l }]));
  const touchedLots = new Set<string>();
  const movements: StockMovement[] = [];
  const now = nowIso();
  const home = defaultLocation(locations);
  const homeId = home.location.id;
  const locationName = (id: string) => (id === homeId ? home.location.name : (locations.find((l) => l.id === id)?.name ?? id));

  for (const input of inputs) {
    const item = byId.get(input.itemId);
    if (!item) throw new InventoryError(`Unknown item ${input.itemId}`);
    if (input.qty === 0) continue;
    const locationId = input.locationId ?? homeId;
    if (locationId !== homeId && !locations.some((l) => l.id === locationId)) throw new InventoryError(`Unknown location ${locationId}`);
    const stock = stockMap(item, homeId);
    const entry: ItemStock = { ...(stock[locationId] ?? { qty: 0 }) };
    const atLocation = round(entry.qty + input.qty, 3);
    if (atLocation < 0 && !opts.allowNegative) {
      throw new InventoryError(`Not enough ${item.sku} at ${locationName(locationId)} (have ${entry.qty}, need ${-input.qty})`, { itemId: item.id, have: entry.qty, need: -input.qty, locationId });
    }
    entry.qty = atLocation;
    stock[locationId] = entry;
    item.stock = stock;
    const balanceAfter = round(Object.values(stock).reduce((a, e) => a + e.qty, 0), 3);
    item.onHand = balanceAfter;
    item.updatedAt = now;
    item.updatedBy = actor.id;
    const m: StockMovement = {
      id: newId("mv"),
      itemId: item.id,
      type: input.type,
      qty: input.qty,
      unitCost: input.unitCost ?? item.unitCost,
      locationId,
      lotId: input.lotId,
      refType: input.refType,
      refId: input.refId,
      reason: input.reason,
      note: input.note,
      balanceAfter,
      occurredAt: input.occurredAt ?? now,
      createdAt: now,
      createdBy: actor.id,
    };
    movements.push(m);

    // Lot bookkeeping (FIFO relief on consumption; explicit lot on receipt).
    if (input.qty < 0) {
      let remaining = -input.qty;
      const candidates = Array.from(lotById.values())
        .filter((l) => l.itemId === item.id && l.qtyRemaining > 0)
        .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
      for (const lot of candidates) {
        if (remaining <= 0) break;
        const take = Math.min(lot.qtyRemaining, remaining);
        lot.qtyRemaining = round(lot.qtyRemaining - take, 3);
        remaining -= take;
        touchedLots.add(lot.id);
      }
    }
  }

  const ops: WriteOp[] = [];
  if (home.created && movements.length > 0) ops.push({ op: "put", collection: "locations", doc: home.location });
  const itemPatches = new Map<string, Partial<Item>>();
  for (const m of movements) ops.push({ op: "put", collection: "movements", doc: m });
  for (const id of new Set(movements.map((m) => m.itemId))) {
    const it = byId.get(id)!;
    const patch: Partial<Item> = { onHand: it.onHand, stock: it.stock, updatedAt: it.updatedAt, updatedBy: it.updatedBy };
    itemPatches.set(id, patch);
    ops.push({ op: "patch", collection: "items", id, patch });
  }
  for (const id of touchedLots) {
    const lot = lotById.get(id)!;
    ops.push({ op: "patch", collection: "lots", id, patch: { qtyRemaining: lot.qtyRemaining } });
  }
  return { ops, movements, itemPatches, homeId };
}

export interface AdjustInput {
  itemId: string;
  /** Provide exactly one of qtyDelta or newQty. */
  qtyDelta?: number;
  newQty?: number;
  type?: Extract<MovementType, "adjustment" | "count" | "write_off">;
  reason?: string;
  note?: string;
  occurredAt?: string;
  refType?: RefType;
  refId?: string;
  /** Count or adjust one location; defaults to the workspace default. */
  locationId?: string;
}

/** Factor 12: adjustments, counts and write-offs. */
export async function adjustStock(store: Store, actor: Actor, inputs: AdjustInput[]): Promise<StockMovement[]> {
  const items = await store.list("items");
  const homeId = defaultLocation(await store.list("locations")).location.id;
  const byId = new Map(items.map((i) => [i.id, i]));
  const movementInputs: MovementInput[] = [];
  for (const a of inputs) {
    const item = byId.get(a.itemId);
    if (!item) throw new InventoryError(`Unknown item ${a.itemId}`);
    const current = a.locationId ? qtyAt(item, a.locationId, homeId) : item.onHand;
    const delta = a.newQty !== undefined ? round(a.newQty - current, 3) : (a.qtyDelta ?? 0);
    if (delta === 0) continue;
    movementInputs.push({
      itemId: item.id,
      type: a.type ?? (a.newQty !== undefined ? "count" : delta < 0 ? "write_off" : "adjustment"),
      qty: delta,
      reason: a.reason,
      note: a.note,
      occurredAt: a.occurredAt,
      refType: a.refType ?? "manual",
      refId: a.refId,
      locationId: a.locationId,
    });
  }
  if (movementInputs.length === 0) return [];
  const { ops, movements } = await movementOps(store, actor, movementInputs);
  // Positive adjustments create a lot so shelf-life stays meaningful.
  for (const m of movements) {
    if (m.qty > 0) {
      const lot: Lot = { id: newId("lot"), itemId: m.itemId, qtyReceived: m.qty, qtyRemaining: m.qty, unitCost: m.unitCost ?? 0, receivedAt: m.occurredAt };
      ops.push({ op: "put", collection: "lots", doc: lot });
    }
  }
  const writeOffs = movements.filter((m) => m.type === "write_off");
  const others = movements.filter((m) => m.type !== "write_off");
  // Single-item changes are tagged with the item so its activity card picks them up.
  const entity = (ms: StockMovement[]) => (ms.length === 1 ? { entityType: "item" as const, entityId: ms[0]!.itemId } : {});
  if (writeOffs.length) {
    ops.push(activityOp(actor, "stock.written_off", describeMovements(actor, byId, writeOffs, "wrote off"), { ...entity(writeOffs), meta: { count: writeOffs.length } }));
  }
  if (others.length) {
    ops.push(activityOp(actor, "stock.adjusted", describeMovements(actor, byId, others, "adjusted"), { ...entity(others), meta: { count: others.length } }));
  }
  await store.batch(ops);
  return movements;
}

function describeMovements(actor: Actor, byId: Map<string, Item>, ms: StockMovement[], verb: string): string {
  if (ms.length === 1) {
    const it = byId.get(ms[0]!.itemId)!;
    const sign = ms[0]!.qty > 0 ? "+" : "";
    return `${actor.name} ${verb} ${it.sku} (${sign}${ms[0]!.qty} → ${ms[0]!.balanceAfter})${ms[0]!.reason ? ` · ${ms[0]!.reason}` : ""}`;
  }
  return `${actor.name} ${verb} stock on ${ms.length} items`;
}

export interface ReceiveInput {
  supplierId?: string;
  reference?: string;
  receivedAt?: string;
  note?: string;
  lines: Array<{ itemId: string; qty: number; unitCost?: number; locationId?: string; bin?: string }>;
  /** Update the item's standard cost to the received cost. Default true. */
  updateStandardCost?: boolean;
}

/** Factor 7: receiving, with back-dating that keeps today's totals correct. */
export async function receiveStock(store: Store, actor: Actor, input: ReceiveInput): Promise<Receipt> {
  if (input.lines.length === 0) throw new InventoryError("A receipt needs at least one line");
  const items = await store.list("items");
  const byId = new Map(items.map((i) => [i.id, i]));
  const { number, ops: counterOps } = await nextNumber(store, "receipt");
  const receivedAt = input.receivedAt ?? nowIso();
  const receipt: Receipt = {
    id: newId("rcv"),
    number,
    supplierId: input.supplierId,
    reference: input.reference,
    status: "received",
    receivedAt,
    lines: [],
    note: input.note,
    createdAt: nowIso(),
    createdBy: actor.id,
  };
  const ops: WriteOp[] = [...counterOps];
  const movementInputs: MovementInput[] = [];
  for (const line of input.lines) {
    const item = byId.get(line.itemId);
    if (!item) throw new InventoryError(`Unknown item ${line.itemId}`);
    if (line.qty <= 0) throw new InventoryError(`Quantity for ${item.sku} must be positive`);
    const unitCost = line.unitCost ?? item.unitCost;
    const lot: Lot = { id: newId("lot"), itemId: item.id, receiptId: receipt.id, qtyReceived: line.qty, qtyRemaining: line.qty, unitCost, receivedAt };
    ops.push({ op: "put", collection: "lots", doc: lot });
    receipt.lines.push({ itemId: item.id, qty: line.qty, unitCost, lotId: lot.id });
    movementInputs.push({ itemId: item.id, type: "receipt", qty: line.qty, unitCost, lotId: lot.id, refType: "receipt", refId: receipt.id, occurredAt: receivedAt, locationId: line.locationId });
    if (input.updateStandardCost !== false && unitCost !== item.unitCost) {
      ops.push({ op: "patch", collection: "items", id: item.id, patch: { unitCost } });
    }
  }
  const mv = await movementOps(store, actor, movementInputs);
  // Put-away: remember the bin each line landed in.
  for (const line of input.lines) {
    if (!line.bin?.trim()) continue;
    const patch = mv.itemPatches.get(line.itemId);
    const locationId = line.locationId ?? mv.homeId;
    if (patch?.stock?.[locationId]) patch.stock[locationId] = { ...patch.stock[locationId]!, bin: line.bin.trim() };
  }
  ops.push(...mv.ops);
  ops.push({ op: "put", collection: "receipts", doc: receipt });
  // Factor 34: backordered lines that this delivery covers.
  const ready = backordersCoveredBy(await store.list("orders"), mv.itemPatches, byId);
  if (ready.length) {
    ops.push(activityOp(actor, "order.ready", `${receipt.number} covers ${ready.length} backordered line${ready.length === 1 ? "" : "s"}: ${ready.slice(0, 4).map((r) => `${r.order.number} (${r.sku} × ${r.qty})`).join(", ")}${ready.length > 4 ? "…" : ""}`, { entityType: "receipt", entityId: receipt.id, meta: { orders: Array.from(new Set(ready.map((r) => r.order.id))) } }));
  }
  const total = round(sum(receipt.lines.map((l) => l.qty * l.unitCost)));
  ops.push(activityOp(actor, "stock.received", `${actor.name} received ${receipt.number} · ${receipt.lines.length} line${receipt.lines.length === 1 ? "" : "s"} · $${total.toFixed(2)}`, { entityType: "receipt", entityId: receipt.id, meta: { lines: receipt.lines.length, total } }));
  await store.batch(ops);
  return receipt;
}

export interface BuildInput {
  assemblyId: string;
  qty: number;
  consumeSubassemblies?: boolean;
  note?: string;
  occurredAt?: string;
  /** Consume components from and put the assembly into this location; defaults to the workspace default. */
  locationId?: string;
}

/** Factor 19/20: build an assembly, relieving components (and sub-assemblies) correctly. */
export async function buildAssembly(store: Store, actor: Actor, input: BuildInput): Promise<Build> {
  const items = await store.list("items");
  const assembly = items.find((i) => i.id === input.assemblyId);
  if (!assembly) throw new InventoryError(`Unknown assembly ${input.assemblyId}`);
  if (assembly.bom.length === 0) throw new InventoryError(`${assembly.sku} has no bill of materials`);
  if (input.qty <= 0) throw new InventoryError("Build quantity must be positive");
  if (!Number.isInteger(input.qty)) throw new InventoryError("Build quantity must be a whole number");
  const consumeSub = input.consumeSubassemblies ?? true;
  const reqs = explodeBom(items, assembly, input.qty, { consumeSubassemblies: consumeSub, explodeShortfallOnly: !consumeSub });
  const short = reqs.filter((r) => r.shortage > 0);
  if (short.length) {
    throw new InventoryError(
      `Cannot build ${input.qty} × ${assembly.sku}: short on ${short.map((r) => `${r.item.sku} (need ${r.required}, have ${r.available})`).join(", ")}`,
      { shortages: short.map((r) => ({ sku: r.item.sku, required: r.required, available: r.available })) },
    );
  }
  const { number, ops: counterOps } = await nextNumber(store, "build");
  const occurredAt = input.occurredAt ?? nowIso();
  const build: Build = {
    id: newId("bld"),
    number,
    assemblyId: assembly.id,
    qty: input.qty,
    status: "completed",
    consumeSubassemblies: consumeSub,
    components: reqs.map((r) => ({ itemId: r.item.id, qtyPer: round(r.required / input.qty, 4), qtyConsumed: r.required })),
    note: input.note,
    completedAt: occurredAt,
    createdAt: nowIso(),
    createdBy: actor.id,
  };
  const movementInputs: MovementInput[] = reqs.map((r) => ({ itemId: r.item.id, type: "build_consume", locationId: input.locationId, qty: -r.required, refType: "build", refId: build.id, occurredAt }));
  const cost = rolledUpCost(items, assembly);
  movementInputs.push({ itemId: assembly.id, type: "build_produce", locationId: input.locationId, qty: input.qty, unitCost: cost, refType: "build", refId: build.id, occurredAt });
  const mv = await movementOps(store, actor, movementInputs);
  const lot: Lot = { id: newId("lot"), itemId: assembly.id, qtyReceived: input.qty, qtyRemaining: input.qty, unitCost: cost, receivedAt: occurredAt };
  const ops: WriteOp[] = [
    ...counterOps,
    ...mv.ops,
    { op: "put", collection: "lots", doc: lot },
    { op: "patch", collection: "items", id: assembly.id, patch: { unitCost: cost } },
    { op: "put", collection: "builds", doc: build },
    activityOp(actor, "build.completed", `${actor.name} built ${input.qty} × ${assembly.sku} (${build.number})`, { entityType: "build", entityId: build.id, meta: { qty: input.qty } }),
  ];
  await store.batch(ops);
  return build;
}

export interface OrderInput {
  customer: string;
  source?: SalesOrder["source"];
  note?: string;
  lines: Array<{ itemId: string; qty: number; unitPrice?: number }>;
  /** Fulfil immediately. */
  fulfill?: boolean;
  customerEmail?: string;
  shipTo?: Address;
  channel?: IntegrationId;
  externalId?: string;
  externalRef?: string;
}

export async function createOrder(store: Store, actor: Actor, input: OrderInput): Promise<SalesOrder> {
  if (input.lines.length === 0) throw new InventoryError("An order needs at least one line");
  const items = await store.list("items");
  const byId = new Map(items.map((i) => [i.id, i]));
  const { number, ops } = await nextNumber(store, "order");
  const order: SalesOrder = {
    id: newId("so"),
    number,
    customer: input.customer.trim() || "Walk-in",
    status: "open",
    source: input.source ?? "manual",
    lines: input.lines.map((l) => {
      const item = byId.get(l.itemId);
      if (!item) throw new InventoryError(`Unknown item ${l.itemId}`);
      return { itemId: item.id, qty: l.qty, unitPrice: l.unitPrice ?? priceForQty(item, l.qty) };
    }),
    note: input.note,
    customerEmail: input.customerEmail,
    shipTo: input.shipTo,
    channel: input.channel,
    externalId: input.externalId,
    externalRef: input.externalRef,
    createdAt: nowIso(),
    createdBy: actor.id,
  };
  ops.push({ op: "put", collection: "orders", doc: order });
  ops.push(activityOp(actor, "order.created", `${actor.name} created ${order.number} for ${order.customer}`, { entityType: "order", entityId: order.id }));
  await store.batch(ops);
  if (input.fulfill) return fulfillOrder(store, actor, order.id);
  return order;
}

/** Units on an order line that have not shipped yet. */
export function openQty(line: OrderLine): number {
  return round(line.qty - (line.shipped ?? 0), 3);
}

export function isOrderOpen(order: Pick<SalesOrder, "status">): boolean {
  return order.status === "open" || order.status === "partial";
}

export function orderOpenLines(order: SalesOrder): OrderLine[] {
  return order.lines.filter((l) => openQty(l) > 0);
}

export interface ShipInput {
  orderId: string;
  /** Lines and quantities to ship now. Defaults to everything still open. */
  lines?: Array<{ itemId: string; qty: number }>;
  /** Ship from this location; defaults to the workspace default. */
  locationId?: string;
  carrier?: string;
  service?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  labelUrl?: string;
  cost?: number;
  currency?: string;
  provider?: ShipmentProvider;
  providerRef?: string;
  shippedAt?: string;
  note?: string;
}

/**
 * Factor 34: ship all or part of an order. Relieves stock for the shipped
 * units (or the assembly's components when policy is "on_fulfill"), records a
 * Shipment with any carrier details, and leaves the rest of the order open.
 */
export async function shipOrder(store: Store, actor: Actor, input: ShipInput): Promise<{ order: SalesOrder; shipment: Shipment }> {
  const order = await store.get("orders", input.orderId);
  if (!order) throw new InventoryError("Order not found");
  if (!isOrderOpen(order)) throw new InventoryError(`${order.number} is already ${order.status}`);
  const settings = await loadSettings(store);
  const items = await store.list("items");
  const homeId = defaultLocation(await store.list("locations")).location.id;
  const locationId = input.locationId ?? homeId;
  const byId = new Map(items.map((i) => [i.id, i]));
  const shippedAt = input.shippedAt ?? nowIso();
  const lines = order.lines.map((l) => ({ ...l }));
  const requested = (input.lines ?? lines.map((l) => ({ itemId: l.itemId, qty: openQty(l) }))).filter((l) => l.qty > 0);
  if (requested.length === 0) throw new InventoryError(`${order.number} has nothing left to ship`);

  const movementInputs: MovementInput[] = [];
  const shipLines: ShipmentLine[] = [];
  for (const req of requested) {
    const line = lines.find((l) => l.itemId === req.itemId && openQty(l) > 0);
    const item = byId.get(req.itemId);
    if (!line || !item) throw new InventoryError(`${order.number} has no open line for ${item?.sku ?? req.itemId}`);
    const open = openQty(line);
    if (req.qty > open + 1e-9) throw new InventoryError(`Only ${open} of ${item.sku} is still open on ${order.number}`);
    const available = qtyAt(item, locationId, homeId);
    if (settings.relievePolicy === "on_fulfill" && item.type === "assembly" && item.bom.length > 0 && available < req.qty) {
      // Relieve components for the portion not on the shelf.
      const fromStock = Math.max(0, available);
      if (fromStock > 0) movementInputs.push({ itemId: item.id, type: "sale", qty: -fromStock, refType: "order", refId: order.id, occurredAt: shippedAt, locationId });
      const reqs = explodeBom(items, item, req.qty - fromStock, { explodeShortfallOnly: true });
      const short = reqs.filter((r) => r.shortage > 0);
      if (short.length) throw new InventoryError(`Cannot ship ${order.number}: short on ${short.map((r) => r.item.sku).join(", ")}`, { shortages: short });
      for (const r of reqs) movementInputs.push({ itemId: r.item.id, type: "sale", qty: -r.required, refType: "order", refId: order.id, occurredAt: shippedAt, note: `Component of ${item.sku}`, locationId });
    } else {
      if (available < req.qty) {
        throw new InventoryError(`Cannot ship ${order.number}: ${item.sku} has ${available} available, need ${req.qty}${item.type === "assembly" ? ". Build more first." : ""}`, { itemId: item.id });
      }
      movementInputs.push({ itemId: item.id, type: "sale", qty: -req.qty, unitCost: item.unitCost, refType: "order", refId: order.id, occurredAt: shippedAt, locationId });
    }
    line.shipped = round((line.shipped ?? 0) + req.qty, 3);
    shipLines.push({ itemId: item.id, qty: req.qty });
  }

  const complete = lines.every((l) => openQty(l) <= 0);
  const { number, ops: counterOps } = await nextNumber(store, "shipment");
  const shipment: Shipment = {
    id: newId("shp"),
    number,
    orderId: order.id,
    lines: shipLines,
    locationId,
    carrier: input.carrier,
    service: input.service,
    trackingNumber: input.trackingNumber,
    trackingUrl: input.trackingUrl,
    labelUrl: input.labelUrl,
    cost: input.cost,
    currency: input.currency,
    provider: input.provider ?? (input.trackingNumber ? "manual" : undefined),
    providerRef: input.providerRef,
    note: input.note,
    shippedAt,
    createdAt: nowIso(),
    createdBy: actor.id,
  };
  const mv = await movementOps(store, actor, movementInputs);
  const patch: Partial<SalesOrder> = complete ? { lines, status: "fulfilled", fulfilledAt: shippedAt } : { lines, status: "partial" };
  const units = sum(shipLines.map((l) => l.qty));
  const ops: WriteOp[] = [
    ...counterOps,
    ...mv.ops,
    { op: "put", collection: "shipments", doc: shipment },
    { op: "patch", collection: "orders", id: order.id, patch },
    activityOp(
      actor,
      complete ? "order.fulfilled" : "order.shipped",
      complete
        ? `${actor.name} shipped ${order.number} to ${order.customer}${input.trackingNumber ? ` · ${input.carrier ?? "tracking"} ${input.trackingNumber}` : ""}`
        : `${actor.name} shipped ${units} of ${sum(order.lines.map((l) => l.qty))} units on ${order.number}, rest backordered`,
      { entityType: "order", entityId: order.id, meta: { shipmentId: shipment.id } },
    ),
  ];
  await store.batch(ops);
  return { order: { ...order, ...patch }, shipment };
}

/** Ship everything still open on an order. */
export async function fulfillOrder(store: Store, actor: Actor, orderId: string): Promise<SalesOrder> {
  return (await shipOrder(store, actor, { orderId })).order;
}

export interface BackorderRow {
  order: SalesOrder;
  line: OrderLine;
  item?: Item;
  supplier?: Supplier;
  openQty: number;
  available: number;
  shortBy: number;
  /** Earliest date the shortfall could land, from the item's or supplier's lead time. */
  expectedAt?: string;
}

/** Open order lines that cannot ship from what is on hand right now. */
export function backorderReport(orders: SalesOrder[], items: Item[], suppliers: Supplier[], now: number = Date.now()): BackorderRow[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const out: BackorderRow[] = [];
  for (const order of orders) {
    if (!isOrderOpen(order)) continue;
    for (const line of order.lines) {
      const open = openQty(line);
      if (open <= 0) continue;
      const item = byId.get(line.itemId);
      const available = item?.onHand ?? 0;
      if (available >= open) continue;
      const supplier = item?.supplierId ? supplierById.get(item.supplierId) : undefined;
      const lead = item?.leadTimeDays ?? supplier?.leadTimeDays;
      out.push({ order, line, item, supplier, openQty: open, available, shortBy: round(open - available, 3), expectedAt: lead !== undefined ? new Date(now + lead * 86_400_000).toISOString() : undefined });
    }
  }
  return out.sort((a, b) => a.order.createdAt.localeCompare(b.order.createdAt));
}

/** Whether an open order has at least one line that is short. */
export function orderIsBackordered(order: SalesOrder, byId: Map<string, Item>): boolean {
  return isOrderOpen(order) && order.lines.some((l) => openQty(l) > 0 && (byId.get(l.itemId)?.onHand ?? 0) < openQty(l));
}

/** Backordered lines that the just-received quantities now cover in full. */
function backordersCoveredBy(orders: SalesOrder[], patches: Map<string, Partial<Item>>, byId: Map<string, Item>): Array<{ order: SalesOrder; sku: string; qty: number }> {
  const out: Array<{ order: SalesOrder; sku: string; qty: number }> = [];
  for (const order of orders) {
    if (!isOrderOpen(order)) continue;
    for (const line of order.lines) {
      const patch = patches.get(line.itemId);
      const item = byId.get(line.itemId);
      if (!patch || !item) continue;
      const open = openQty(line);
      const before = item.onHand;
      const after = patch.onHand ?? before;
      if (open > 0 && before < open && after >= open) out.push({ order, sku: item.sku, qty: open });
    }
  }
  return out;
}

export async function cancelOrder(store: Store, actor: Actor, orderId: string): Promise<void> {
  const order = await store.get("orders", orderId);
  if (!order) throw new InventoryError("Order not found");
  if (!isOrderOpen(order)) throw new InventoryError(`${order.number} is ${order.status}`);
  await store.batch([
    { op: "patch", collection: "orders", id: orderId, patch: { status: "cancelled" } },
    activityOp(actor, "order.cancelled", `${actor.name} cancelled ${order.number}`, { entityType: "order", entityId: order.id }),
  ]);
}

export interface RmaInput {
  customer: string;
  orderId?: string;
  reference?: string;
  reason: string;
  note?: string;
  lines: Array<{ itemId: string; qty: number; condition?: Rma["lines"][number]["condition"] }>;
}

/** Factor 11: RMA ticket creation. */
export async function createRma(store: Store, actor: Actor, input: RmaInput): Promise<Rma> {
  if (input.lines.length === 0) throw new InventoryError("An RMA needs at least one line");
  const { number, ops } = await nextNumber(store, "rma");
  const rma: Rma = {
    id: newId("rma"),
    number,
    customer: input.customer.trim() || "Unknown customer",
    orderId: input.orderId,
    reference: input.reference,
    status: "open",
    reason: input.reason,
    lines: input.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, condition: l.condition ?? "unknown" })),
    note: input.note,
    createdAt: nowIso(),
    createdBy: actor.id,
  };
  ops.push({ op: "put", collection: "rmas", doc: rma });
  ops.push(activityOp(actor, "rma.created", `${actor.name} opened ${rma.number} for ${rma.customer}`, { entityType: "rma", entityId: rma.id }));
  await store.batch(ops);
  return rma;
}

/** Resolve an RMA: restocked lines come back into inventory automatically. */
export async function resolveRma(
  store: Store,
  actor: Actor,
  rmaId: string,
  dispositions: Array<{ itemId: string; disposition: RmaDisposition; condition?: Rma["lines"][number]["condition"] }>,
  note?: string,
): Promise<Rma> {
  const rma = await store.get("rmas", rmaId);
  if (!rma) throw new InventoryError("RMA not found");
  if (rma.status !== "open" && rma.status !== "inspecting") throw new InventoryError(`${rma.number} is already ${rma.status}`);
  const resolvedAt = nowIso();
  const lines = rma.lines.map((l) => {
    const d = dispositions.find((x) => x.itemId === l.itemId);
    return { ...l, disposition: d?.disposition ?? "refund", condition: d?.condition ?? l.condition };
  });
  const restock = lines.filter((l) => l.disposition === "restock");
  const movementInputs: MovementInput[] = restock.map((l) => ({ itemId: l.itemId, type: "rma_return", qty: l.qty, refType: "rma", refId: rma.id, occurredAt: resolvedAt, reason: `Restocked from ${rma.number}` }));
  const ops: WriteOp[] = [];
  if (movementInputs.length) {
    const mv = await movementOps(store, actor, movementInputs);
    ops.push(...mv.ops);
    for (const m of mv.movements) {
      ops.push({ op: "put", collection: "lots", doc: { id: newId("lot"), itemId: m.itemId, qtyReceived: m.qty, qtyRemaining: m.qty, unitCost: m.unitCost ?? 0, receivedAt: resolvedAt } });
    }
  }
  const status: Rma["status"] = restock.length ? "restocked" : lines.some((l) => l.disposition === "scrap") ? "scrapped" : "refunded";
  ops.push({ op: "patch", collection: "rmas", id: rma.id, patch: { status, lines, resolvedAt, note: note ?? rma.note } });
  ops.push(activityOp(actor, "rma.resolved", `${actor.name} resolved ${rma.number} · ${status}${restock.length ? ` · ${sum(restock.map((l) => l.qty))} restocked` : ""}`, { entityType: "rma", entityId: rma.id }));
  await store.batch(ops);
  return { ...rma, status, lines, resolvedAt };
}

// ---- Items ---------------------------------------------------------------

export async function createItems(store: Store, actor: Actor, inputs: Array<Partial<Item> & { sku: string; name: string; openingQty?: number }>): Promise<Item[]> {
  const existing = await store.list("items");
  const taken = new Set(existing.map((i) => i.sku.toUpperCase()));
  const created: Item[] = [];
  const ops: WriteOp[] = [];
  for (const input of inputs) {
    const sku = input.sku.trim().toUpperCase();
    if (!sku || !input.name?.trim()) throw new InventoryError("SKU and name are required");
    if (taken.has(sku)) throw new InventoryError(`SKU ${sku} already exists`);
    taken.add(sku);
    const item = itemDefaults({ ...input, sku, onHand: 0, updatedBy: actor.id });
    created.push(item);
    ops.push({ op: "put", collection: "items", doc: item });
  }
  ops.push(
    activityOp(actor, "item.created", created.length === 1 ? `${actor.name} created ${created[0]!.sku} · ${created[0]!.name}` : `${actor.name} created ${created.length} items`, {
      entityType: created.length === 1 ? "item" : undefined,
      entityId: created.length === 1 ? created[0]!.id : undefined,
      meta: { count: created.length },
    }),
  );
  await store.batch(ops);
  // Opening quantities go through the ledger.
  const opening = inputs
    .map((input, i) => ({ item: created[i]!, qty: input.openingQty ?? 0 }))
    .filter((x) => x.qty > 0);
  if (opening.length) {
    await adjustStock(store, actor, opening.map((o) => ({ itemId: o.item.id, qtyDelta: o.qty, type: "count" as const, reason: "Opening balance" })));
  }
  return created;
}

export type ItemPatch = Partial<Omit<Item, "id" | "onHand" | "createdAt" | "bom">> & { bom?: Item["bom"] };

export async function updateItem(store: Store, actor: Actor, itemId: string, patch: ItemPatch, reason?: string): Promise<void> {
  const item = await store.get("items", itemId);
  if (!item) throw new InventoryError("Item not found");
  if (patch.sku && patch.sku.toUpperCase() !== item.sku) {
    const all = await store.list("items");
    if (all.some((i) => i.id !== itemId && i.sku.toUpperCase() === patch.sku!.toUpperCase())) throw new InventoryError(`SKU ${patch.sku} already exists`);
    patch.sku = patch.sku.toUpperCase();
  }
  const changed = Object.keys(patch).filter((k) => JSON.stringify((patch as Record<string, unknown>)[k]) !== JSON.stringify((item as unknown as Record<string, unknown>)[k]));
  if (changed.length === 0) return;
  await store.batch([
    { op: "patch", collection: "items", id: itemId, patch: { ...patch, updatedAt: nowIso(), updatedBy: actor.id } },
    activityOp(actor, "item.updated", `${actor.name} updated ${item.sku} (${changed.join(", ")})${reason ? ` · ${reason}` : ""}`, { entityType: "item", entityId: itemId, meta: { fields: changed } }),
  ]);
}

/** Bulk field update — Nimbus's bread and butter. */
export async function bulkUpdateItems(store: Store, actor: Actor, itemIds: string[], patch: ItemPatch, reason?: string): Promise<number> {
  if (itemIds.length === 0) return 0;
  const items = await store.list("items");
  const byId = new Map(items.map((i) => [i.id, i]));
  const ops: WriteOp[] = [];
  let count = 0;
  for (const id of itemIds) {
    if (!byId.has(id)) continue;
    ops.push({ op: "patch", collection: "items", id, patch: { ...patch, updatedAt: nowIso(), updatedBy: actor.id } });
    count++;
  }
  const fields = Object.keys(patch).join(", ");
  ops.push(activityOp(actor, "item.updated", `${actor.name} updated ${fields} on ${count} item${count === 1 ? "" : "s"}${reason ? ` · ${reason}` : ""}`, { meta: { count, fields: Object.keys(patch) } }));
  await store.batch(ops);
  return count;
}

/** Factor 16: deactivate / supersede part numbers in bulk. */
export async function deactivateItems(store: Store, actor: Actor, itemIds: string[], opts: { supersededBy?: string; reason?: string } = {}): Promise<number> {
  const patch: ItemPatch = opts.supersededBy ? { status: "superseded", supersededBy: opts.supersededBy } : { status: "inactive" };
  return bulkUpdateItems(store, actor, itemIds, patch, opts.reason ?? (opts.supersededBy ? "Superseded" : "Deactivated"));
}

/** Open orders and RMAs that still reference any of the items. Deleting would strand them. */
export async function openReferences(store: Store, itemIds: string[]): Promise<{ orders: SalesOrder[]; rmas: Rma[] }> {
  const ids = new Set(itemIds);
  const [orders, rmas] = await Promise.all([store.list("orders"), store.list("rmas")]);
  return {
    orders: orders.filter((o) => o.status === "open" && o.lines.some((l) => ids.has(l.itemId))),
    rmas: rmas.filter((r) => (r.status === "open" || r.status === "inspecting") && r.lines.some((l) => ids.has(l.itemId))),
  };
}

export async function deleteItems(store: Store, actor: Actor, itemIds: string[]): Promise<void> {
  const ids = new Set(itemIds);
  const refs = await openReferences(store, itemIds);
  if (refs.orders.length || refs.rmas.length) {
    const what = [refs.orders.length ? `${refs.orders.length} open order${refs.orders.length === 1 ? "" : "s"} (${refs.orders.map((o) => o.number).slice(0, 3).join(", ")})` : "", refs.rmas.length ? `${refs.rmas.length} open RMA${refs.rmas.length === 1 ? "" : "s"} (${refs.rmas.map((r) => r.number).slice(0, 3).join(", ")})` : ""].filter(Boolean).join(" and ");
    throw new InventoryError(`Cannot delete: still referenced by ${what}. Ship, cancel or resolve them first, or deactivate the item instead.`);
  }
  const items = await store.list("items");
  const movements = await store.list("movements");
  const lots = await store.list("lots");
  const ops: WriteOp[] = [];
  for (const id of ids) ops.push({ op: "remove", collection: "items", id });
  for (const m of movements) if (ids.has(m.itemId)) ops.push({ op: "remove", collection: "movements", id: m.id });
  for (const l of lots) if (ids.has(l.itemId)) ops.push({ op: "remove", collection: "lots", id: l.id });
  for (const it of items) {
    if (ids.has(it.id)) continue;
    if (it.bom.some((l) => ids.has(l.itemId))) ops.push({ op: "patch", collection: "items", id: it.id, patch: { bom: it.bom.filter((l) => !ids.has(l.itemId)) } });
  }
  const names = items.filter((i) => ids.has(i.id)).map((i) => i.sku);
  // Linked store products are removed on the next push (a tombstone survives the item).
  for (const it of items) {
    if (!ids.has(it.id) || !it.channels) continue;
    for (const channel of ["shopify", "woocommerce"] as const) {
      const ref = it.channels[channel];
      if (ref) ops.push({ op: "put", collection: "channelTombstones", doc: { id: newId("tomb"), channel, sku: it.sku, itemId: it.id, ref, deletedAt: nowIso(), deletedBy: actor.id } });
    }
  }
  ops.push(activityOp(actor, "item.deleted", `${actor.name} deleted ${names.length === 1 ? names[0] : `${names.length} items`}`, { meta: { count: names.length } }));
  await store.batch(ops);
}

// ---------------------------------------------------------------------------
// Factor 30: transfers between locations
// ---------------------------------------------------------------------------

export interface TransferInput {
  fromLocationId: string;
  toLocationId: string;
  lines: Array<{ itemId: string; qty: number }>;
  note?: string;
  carrier?: string;
  trackingNumber?: string;
  shippedAt?: string;
}

/** Stock leaves the origin now and sits in transit until the transfer is received. */
export async function createTransfer(store: Store, actor: Actor, input: TransferInput): Promise<Transfer> {
  if (input.fromLocationId === input.toLocationId) throw new InventoryError("Pick two different locations");
  const locations = await store.list("locations");
  const from = locations.find((l) => l.id === input.fromLocationId);
  const to = locations.find((l) => l.id === input.toLocationId);
  if (!from || !to) throw new InventoryError("Unknown location");
  if (!to.active) throw new InventoryError(`${to.name} is not active`);
  const lines = input.lines.filter((l) => l.qty > 0);
  if (lines.length === 0) throw new InventoryError("A transfer needs at least one line");
  const items = await store.list("items");
  const byId = new Map(items.map((i) => [i.id, i]));
  const { number, ops: counterOps } = await nextNumber(store, "transfer");
  const shippedAt = input.shippedAt ?? nowIso();
  const transfer: Transfer = {
    id: newId("tr"),
    number,
    fromLocationId: from.id,
    toLocationId: to.id,
    status: "in_transit",
    lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty })),
    note: input.note,
    carrier: input.carrier,
    trackingNumber: input.trackingNumber,
    shippedAt,
    createdAt: nowIso(),
    createdBy: actor.id,
  };
  const mv = await movementOps(
    store,
    actor,
    lines.map((l) => ({ itemId: l.itemId, type: "transfer_out" as const, qty: -l.qty, refType: "transfer" as const, refId: transfer.id, occurredAt: shippedAt, locationId: from.id, note: `To ${to.name}` })),
  );
  for (const l of lines) {
    const patch = mv.itemPatches.get(l.itemId);
    const item = byId.get(l.itemId);
    if (patch && item) patch.inTransit = round((item.inTransit ?? 0) + l.qty, 3);
  }
  const units = sum(lines.map((l) => l.qty));
  await store.batch([
    ...counterOps,
    ...mv.ops,
    { op: "put", collection: "transfers", doc: transfer },
    activityOp(actor, "transfer.created", `${actor.name} sent ${transfer.number}: ${units} unit${units === 1 ? "" : "s"} from ${from.name} to ${to.name}`, { entityType: "transfer", entityId: transfer.id }),
  ]);
  return transfer;
}

/** Book the transfer in at its destination. Units short of what was sent are written off there. */
export async function receiveTransfer(store: Store, actor: Actor, transferId: string, received?: Array<{ itemId: string; qty: number }>): Promise<Transfer> {
  const transfer = await store.get("transfers", transferId);
  if (!transfer) throw new InventoryError("Transfer not found");
  if (transfer.status !== "in_transit") throw new InventoryError(`${transfer.number} is already ${transfer.status.replace("_", " ")}`);
  const locations = await store.list("locations");
  const to = locations.find((l) => l.id === transfer.toLocationId);
  if (!to) throw new InventoryError("Destination location no longer exists");
  const items = await store.list("items");
  const byId = new Map(items.map((i) => [i.id, i]));
  const receivedAt = nowIso();
  const movementInputs: MovementInput[] = [];
  const lines = transfer.lines.map((l) => {
    const got = received?.find((r) => r.itemId === l.itemId)?.qty ?? l.qty;
    if (got < 0 || got > l.qty + 1e-9) throw new InventoryError(`Received quantity for ${byId.get(l.itemId)?.sku ?? l.itemId} must be between 0 and ${l.qty}`);
    movementInputs.push({ itemId: l.itemId, type: "transfer_in", qty: l.qty, refType: "transfer", refId: transfer.id, occurredAt: receivedAt, locationId: to.id, note: `${transfer.number}` });
    const missing = round(l.qty - got, 3);
    if (missing > 0) movementInputs.push({ itemId: l.itemId, type: "write_off", qty: -missing, refType: "transfer", refId: transfer.id, occurredAt: receivedAt, locationId: to.id, reason: `Missing on arrival of ${transfer.number}` });
    return { ...l, receivedQty: got };
  });
  const mv = await movementOps(store, actor, movementInputs);
  for (const l of transfer.lines) {
    const patch = mv.itemPatches.get(l.itemId);
    const item = byId.get(l.itemId);
    if (patch && item) patch.inTransit = Math.max(0, round((item.inTransit ?? 0) - l.qty, 3));
  }
  const missingUnits = sum(lines.map((l) => l.qty - (l.receivedQty ?? l.qty)));
  const patch: Partial<Transfer> = { status: "received", lines, receivedAt, receivedBy: actor.id };
  await store.batch([
    ...mv.ops,
    { op: "patch", collection: "transfers", id: transfer.id, patch },
    activityOp(actor, "transfer.received", `${actor.name} received ${transfer.number} at ${to.name}${missingUnits > 0 ? ` · ${missingUnits} unit${missingUnits === 1 ? "" : "s"} missing, written off` : ""}`, { entityType: "transfer", entityId: transfer.id }),
  ]);
  return { ...transfer, ...patch };
}

/** Bring an in-transit transfer back to where it left from. */
export async function cancelTransfer(store: Store, actor: Actor, transferId: string): Promise<void> {
  const transfer = await store.get("transfers", transferId);
  if (!transfer) throw new InventoryError("Transfer not found");
  if (transfer.status !== "in_transit") throw new InventoryError(`${transfer.number} is already ${transfer.status.replace("_", " ")}`);
  const items = await store.list("items");
  const byId = new Map(items.map((i) => [i.id, i]));
  const mv = await movementOps(
    store,
    actor,
    transfer.lines.map((l) => ({ itemId: l.itemId, type: "transfer_in" as const, qty: l.qty, refType: "transfer" as const, refId: transfer.id, locationId: transfer.fromLocationId, note: `${transfer.number} cancelled` })),
  );
  for (const l of transfer.lines) {
    const patch = mv.itemPatches.get(l.itemId);
    const item = byId.get(l.itemId);
    if (patch && item) patch.inTransit = Math.max(0, round((item.inTransit ?? 0) - l.qty, 3));
  }
  await store.batch([
    ...mv.ops,
    { op: "patch", collection: "transfers", id: transfer.id, patch: { status: "cancelled" } },
    activityOp(actor, "transfer.cancelled", `${actor.name} cancelled ${transfer.number}; stock returned to origin`, { entityType: "transfer", entityId: transfer.id }),
  ]);
}

/** Set or clear the bin an item occupies at a location. */
export async function setBin(store: Store, actor: Actor, itemId: string, locationId: string, bin: string): Promise<void> {
  const item = await store.get("items", itemId);
  if (!item) throw new InventoryError("Item not found");
  const homeId = defaultLocation(await store.list("locations")).location.id;
  const stock = stockMap(item, homeId);
  const entry: ItemStock = { ...(stock[locationId] ?? { qty: 0 }) };
  const trimmed = bin.trim();
  if (trimmed) entry.bin = trimmed;
  else delete entry.bin;
  stock[locationId] = entry;
  const patch: Partial<Item> = { stock, updatedAt: nowIso(), updatedBy: actor.id };
  if (locationId === homeId) patch.location = trimmed || undefined;
  await store.patch("items", itemId, patch);
}

export async function upsertSupplier(store: Store, actor: Actor, input: Partial<Supplier> & { name: string }): Promise<Supplier> {
  const supplier: Supplier = {
    id: input.id ?? newId("sup"),
    name: input.name.trim(),
    email: input.email,
    phone: input.phone,
    website: input.website,
    leadTimeDays: input.leadTimeDays,
    terms: input.terms,
    notes: input.notes,
    createdAt: input.createdAt ?? nowIso(),
  };
  await store.put("suppliers", supplier);
  return supplier;
}

// ---- Import ---------------------------------------------------------------

export interface ImportRow {
  sku: string;
  name?: string;
  description?: string;
  category?: string;
  type?: Item["type"];
  unit?: string;
  qty?: number;
  unitCost?: number;
  price?: number;
  salePrice?: number;
  minQty?: number;
  maxQty?: number;
  leadTimeDays?: number;
  location?: string;
  barcode?: string;
  supplierName?: string;
  tags?: string[];
  brand?: string;
  weight?: number;
  length?: number;
  width?: number;
  height?: number;
  imageUrl?: string;
  /** Id in the source system (Shopify / WooCommerce product id). */
  externalId?: string;
  externalSource?: "shopify" | "woocommerce";
  /** false marks the item inactive (unpublished / draft in the source). */
  published?: boolean;
  /** Custom fields mapped on import. */
  attributes?: Record<string, string>;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

/** Upsert items by SKU. Quantities flow through the ledger as "import" movements. */
export async function importItems(store: Store, actor: Actor, rows: ImportRow[], opts: { setQuantities?: boolean } = {}): Promise<ImportResult> {
  const items = await store.list("items");
  const suppliers = await store.list("suppliers");
  const bySku = new Map(items.map((i) => [i.sku.toUpperCase(), i]));
  const supplierByName = new Map(suppliers.map((s) => [s.name.toLowerCase(), s]));
  const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  const ops: WriteOp[] = [];
  const qtyTargets: Array<{ itemId: string; newQty: number }> = [];

  rows.forEach((row, idx) => {
    const sku = (row.sku ?? "").trim().toUpperCase();
    if (!sku) {
      result.errors.push({ row: idx + 1, message: "Missing SKU" });
      result.skipped++;
      return;
    }
    let supplierId: string | undefined;
    if (row.supplierName?.trim()) {
      const key = row.supplierName.trim().toLowerCase();
      let s = supplierByName.get(key);
      if (!s) {
        s = { id: newId("sup"), name: row.supplierName.trim(), createdAt: nowIso() };
        supplierByName.set(key, s);
        ops.push({ op: "put", collection: "suppliers", doc: s });
      }
      supplierId = s.id;
    }
    const fields: Partial<Item> = {};
    if (row.name) fields.name = row.name.trim();
    if (row.description) fields.description = row.description;
    if (row.category) fields.category = row.category.trim();
    if (row.type) fields.type = row.type;
    if (row.unit) fields.unit = row.unit;
    if (row.unitCost !== undefined && Number.isFinite(row.unitCost)) fields.unitCost = row.unitCost;
    if (row.price !== undefined && Number.isFinite(row.price)) fields.price = row.price;
    if (row.minQty !== undefined && Number.isFinite(row.minQty)) fields.minQty = row.minQty;
    if (row.maxQty !== undefined && Number.isFinite(row.maxQty)) fields.maxQty = row.maxQty;
    if (row.leadTimeDays !== undefined && Number.isFinite(row.leadTimeDays)) fields.leadTimeDays = row.leadTimeDays;
    if (row.location) fields.location = row.location;
    if (row.barcode) fields.barcode = row.barcode;
    if (supplierId) fields.supplierId = supplierId;
    if (row.tags?.length) fields.tags = row.tags;
    if (row.salePrice !== undefined && Number.isFinite(row.salePrice)) fields.salePrice = row.salePrice;
    if (row.brand) fields.brand = row.brand.trim();
    if (row.weight !== undefined && Number.isFinite(row.weight)) fields.weight = row.weight;
    if ([row.length, row.width, row.height].some((v) => v !== undefined && Number.isFinite(v))) {
      fields.dimensions = { length: row.length, width: row.width, height: row.height };
    }
    if (row.imageUrl) fields.imageUrl = row.imageUrl.split(/[,|]/)[0]!.trim();
    if (row.externalId && row.externalSource) fields.externalIds = { [row.externalSource]: row.externalId };
    if (row.published === false) fields.status = "inactive";

    const existing = bySku.get(sku);
    if (row.attributes && Object.keys(row.attributes).length) {
      fields.attributes = { ...(existing?.attributes ?? {}), ...row.attributes };
    }
    if (existing) {
      if (fields.externalIds) fields.externalIds = { ...(existing.externalIds ?? {}), ...fields.externalIds };
      ops.push({ op: "patch", collection: "items", id: existing.id, patch: { ...fields, updatedAt: nowIso(), updatedBy: actor.id } });
      result.updated++;
      if (opts.setQuantities && row.qty !== undefined && Number.isFinite(row.qty)) qtyTargets.push({ itemId: existing.id, newQty: row.qty });
    } else {
      if (!row.name?.trim()) {
        result.errors.push({ row: idx + 1, message: `${sku}: name is required for new items` });
        result.skipped++;
        return;
      }
      const item = itemDefaults({ ...fields, sku, name: row.name, updatedBy: actor.id });
      bySku.set(sku, item);
      ops.push({ op: "put", collection: "items", doc: item });
      result.created++;
      if (row.qty !== undefined && Number.isFinite(row.qty) && row.qty !== 0) qtyTargets.push({ itemId: item.id, newQty: row.qty });
    }
  });

  ops.push(activityOp(actor, "import.completed", `${actor.name} imported ${result.created} new and ${result.updated} updated items`, { meta: { ...result } }));
  await store.batch(ops);
  if (qtyTargets.length) {
    await adjustStock(store, actor, qtyTargets.map((t) => ({ itemId: t.itemId, newQty: t.newQty, type: "count" as const, reason: "Imported quantity", refType: "import" as const })));
  }
  return result;
}

/** Per-item patches in one batch with a single activity entry. */
export async function bulkPatchItems(store: Store, actor: Actor, patches: Array<{ id: string; patch: ItemPatch }>, reason: string): Promise<number> {
  if (patches.length === 0) return 0;
  const ops: WriteOp[] = patches.map((p) => ({ op: "patch", collection: "items", id: p.id, patch: { ...p.patch, updatedAt: nowIso(), updatedBy: actor.id } }));
  const fields = Array.from(new Set(patches.flatMap((p) => Object.keys(p.patch)))).join(", ");
  ops.push(activityOp(actor, "item.updated", `${actor.name} updated ${fields} on ${patches.length} item${patches.length === 1 ? "" : "s"} · ${reason}`, { meta: { count: patches.length } }));
  await store.batch(ops);
  return patches.length;
}
