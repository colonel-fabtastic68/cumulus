import type { Build, Customer, Item, Lot, PurchaseOrder, Receipt, SalesOrder, Shipment, StockMovement, Supplier } from "@/lib/types";
import { matches, round } from "@/lib/utils";

/**
 * Traceability: where a batch came from and where every unit of it went.
 * Receipts and builds create lots; every consumption remembers which lots it
 * took from (movement.lots), so a finished assembly can be traced back to the
 * supplier deliveries behind it and a delivery forward to the customers who
 * received it.
 */

export interface TraceSource {
  items: Item[];
  lots: Lot[];
  movements: StockMovement[];
  receipts: Receipt[];
  purchaseOrders: PurchaseOrder[];
  suppliers: Supplier[];
  builds: Build[];
  orders: SalesOrder[];
  shipments?: Shipment[];
  customers?: Customer[];
}

/** A short, stable tag for a batch that pre-dates lot numbers, hashed from its id so look-alike ids still read apart. */
function idTag(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `#${h.toString(36).toUpperCase().padStart(6, "0").slice(-6)}`;
}

/** What to call a batch: its lot number, else the supplier's code, else a tag from its id. */
export function lotLabel(lot: Pick<Lot, "id" | "number" | "supplierLot">): string {
  return lot.number ?? lot.supplierLot ?? idTag(lot.id);
}

export function lotSourceLabel(lot: Lot): string {
  switch (lot.source) {
    case "receipt":
      return "Received";
    case "build":
      return "Built";
    case "rma":
      return "Returned";
    case "import":
      return "Imported";
    case "adjustment":
      return "Adjusted in";
    default:
      return lot.receiptId ? "Received" : lot.buildId ? "Built" : "Opening";
  }
}

/** Lots matching a lot number, supplier code, SKU or document number (receipt, PO, build). */
export function findLots(src: TraceSource, query: string): Lot[] {
  const q = query.trim();
  if (!q) return [];
  const itemById = new Map(src.items.map((i) => [i.id, i]));
  const receiptById = new Map(src.receipts.map((r) => [r.id, r]));
  const poById = new Map(src.purchaseOrders.map((p) => [p.id, p]));
  const buildById = new Map(src.builds.map((b) => [b.id, b]));
  const exact = src.lots.filter((l) => l.number?.toLowerCase() === q.toLowerCase() || l.supplierLot?.toLowerCase() === q.toLowerCase() || l.id === q);
  if (exact.length) return exact;
  return src.lots.filter((l) => {
    const item = itemById.get(l.itemId);
    const receipt = l.receiptId ? receiptById.get(l.receiptId) : undefined;
    const po = l.purchaseOrderId ? poById.get(l.purchaseOrderId) : undefined;
    const build = l.buildId ? buildById.get(l.buildId) : undefined;
    return matches(q, l.number, l.supplierLot, item?.sku, item?.name, receipt?.number, receipt?.reference, po?.number, build?.number);
  });
}

export type LotOrigin =
  | { kind: "receipt"; receipt?: Receipt; purchaseOrder?: PurchaseOrder; supplier?: Supplier }
  | { kind: "build"; build?: Build; components: Array<{ lot: Lot; item?: Item; qty: number }> }
  | { kind: "other"; label: string };

export interface LotUse {
  movement: StockMovement;
  qty: number;
  kind: "sale" | "build" | "write_off" | "adjustment" | "count" | "other";
  order?: SalesOrder;
  customer?: Customer;
  shipments: Shipment[];
  build?: Build;
  /** The batch a build turned this one into. */
  producedLot?: Lot;
  producedItem?: Item;
}

export interface LotTrace {
  lot: Lot;
  item?: Item;
  origin: LotOrigin;
  uses: LotUse[];
  /** Units accounted for by the uses above. */
  used: number;
  remaining: number;
}

function kindOf(m: StockMovement): LotUse["kind"] {
  switch (m.type) {
    case "sale":
      return "sale";
    case "build_consume":
      return "build";
    case "write_off":
      return "write_off";
    case "adjustment":
      return "adjustment";
    case "count":
      return "count";
    default:
      return "other";
  }
}

/** Everything known about one batch: where it came from and where it went. */
export function traceLot(src: TraceSource, lot: Lot): LotTrace {
  const itemById = new Map(src.items.map((i) => [i.id, i]));
  const lotById = new Map(src.lots.map((l) => [l.id, l]));
  const receiptById = new Map(src.receipts.map((r) => [r.id, r]));
  const poById = new Map(src.purchaseOrders.map((p) => [p.id, p]));
  const supplierById = new Map(src.suppliers.map((s) => [s.id, s]));
  const buildById = new Map(src.builds.map((b) => [b.id, b]));
  const orderById = new Map(src.orders.map((o) => [o.id, o]));
  const customerById = new Map((src.customers ?? []).map((c) => [c.id, c]));
  const shipmentsByOrder = new Map<string, Shipment[]>();
  for (const s of src.shipments ?? []) (shipmentsByOrder.get(s.orderId) ?? shipmentsByOrder.set(s.orderId, []).get(s.orderId)!).push(s);

  let origin: LotOrigin;
  if (lot.buildId || lot.source === "build") {
    const build = lot.buildId ? buildById.get(lot.buildId) : undefined;
    const components: LotOrigin & { kind: "build" } = { kind: "build", build, components: [] };
    if (build) {
      for (const m of src.movements) {
        if (m.refType !== "build" || m.refId !== build.id || m.type !== "build_consume") continue;
        for (const a of m.lots ?? []) {
          const source = lotById.get(a.lotId);
          if (source) components.components.push({ lot: source, item: itemById.get(source.itemId), qty: a.qty });
        }
      }
    }
    origin = components;
  } else if (lot.receiptId || lot.source === "receipt") {
    const receipt = lot.receiptId ? receiptById.get(lot.receiptId) : undefined;
    const poId = lot.purchaseOrderId ?? receipt?.lines.find((l) => l.lotId === lot.id)?.purchaseOrderId ?? receipt?.purchaseOrderIds?.[0];
    const purchaseOrder = poId ? poById.get(poId) : undefined;
    const supplierId = lot.supplierId ?? receipt?.supplierId ?? purchaseOrder?.supplierId;
    origin = { kind: "receipt", receipt, purchaseOrder, supplier: supplierId ? supplierById.get(supplierId) : undefined };
  } else {
    origin = { kind: "other", label: lotSourceLabel(lot) };
  }

  const uses: LotUse[] = [];
  for (const m of src.movements) {
    const alloc = m.lots?.find((a) => a.lotId === lot.id);
    if (!alloc) continue;
    const use: LotUse = { movement: m, qty: alloc.qty, kind: kindOf(m), shipments: [] };
    if (m.refType === "order" && m.refId) {
      use.order = orderById.get(m.refId);
      if (use.order?.customerId) use.customer = customerById.get(use.order.customerId);
      use.shipments = (shipmentsByOrder.get(m.refId) ?? []).filter((s) => s.lines.some((l) => l.itemId === lot.itemId));
    }
    if (m.refType === "build" && m.refId) {
      use.build = buildById.get(m.refId);
      const produced = use.build?.lotId ? lotById.get(use.build.lotId) : src.lots.find((l) => l.buildId === m.refId);
      if (produced) {
        use.producedLot = produced;
        use.producedItem = itemById.get(produced.itemId);
      }
    }
    uses.push(use);
  }
  uses.sort((a, b) => a.movement.occurredAt.localeCompare(b.movement.occurredAt));
  const used = round(uses.reduce((t, u) => t + u.qty, 0), 3);
  return { lot, item: itemById.get(lot.itemId), origin, uses, used, remaining: lot.qtyRemaining };
}

/** The batches a finished item was made from, all the way down to supplier deliveries. */
export function upstreamLots(src: TraceSource, lot: Lot, depth = 0, seen = new Set<string>()): Array<{ lot: Lot; item?: Item; qty: number; depth: number; trace: LotTrace }> {
  if (depth > 6 || seen.has(lot.id)) return [];
  seen.add(lot.id);
  const trace = traceLot(src, lot);
  if (trace.origin.kind !== "build") return [];
  const out: Array<{ lot: Lot; item?: Item; qty: number; depth: number; trace: LotTrace }> = [];
  for (const c of trace.origin.components) {
    const childTrace = traceLot(src, c.lot);
    out.push({ lot: c.lot, item: c.item, qty: c.qty, depth, trace: childTrace });
    out.push(...upstreamLots(src, c.lot, depth + 1, seen));
  }
  return out;
}

export interface DownstreamUse {
  /** The batch this use took from: the traced batch itself at depth 0, a batch built from it deeper down. */
  fromLot: Lot;
  fromItem?: Item;
  use: LotUse;
  depth: number;
}

/** Where a batch's units ended up, following builds through to the batches they produced. */
export function downstreamLots(src: TraceSource, lot: Lot, depth = 0, seen = new Set<string>()): DownstreamUse[] {
  if (depth > 6 || seen.has(lot.id)) return [];
  seen.add(lot.id);
  const trace = traceLot(src, lot);
  const out: DownstreamUse[] = [];
  for (const use of trace.uses) {
    out.push({ fromLot: lot, fromItem: trace.item, use, depth });
    if (use.producedLot) out.push(...downstreamLots(src, use.producedLot, depth + 1, seen));
  }
  return out;
}

/** Customers (by order) that received units from this batch, directly or through an assembly built from it. */
export function customersFor(src: TraceSource, lot: Lot): Array<{ order: SalesOrder; qty: number; via?: Lot }> {
  const out: Array<{ order: SalesOrder; qty: number; via?: Lot }> = [];
  for (const d of downstreamLots(src, lot)) {
    if (d.use.kind === "sale" && d.use.order) out.push({ order: d.use.order, qty: d.use.qty, via: d.depth > 0 ? d.fromLot : undefined });
  }
  return out;
}
