import type { CollectionMap, Item, WorkspaceSettings } from "@/lib/types";
import { lineTotal, quoteTotals } from "@/lib/quotes";
import { round } from "@/lib/utils";

/**
 * What can be exported, as flat tables. Every dataset resolves ids to names
 * so the file reads on its own, and every dataset can be narrowed to a set
 * of items (movements of those items, orders containing them, and so on).
 */

export type Cell = string | number | boolean | null | undefined;

export type DatasetId = "items" | "bom" | "stock" | "movements" | "lots" | "receipts" | "builds" | "orders" | "shipments" | "transfers" | "rmas" | "quotes" | "suppliers" | "locations" | "activity";

export interface ExportSource {
  data: Pick<CollectionMap, never> & { [K in keyof CollectionMap]: CollectionMap[K][] };
  settings: WorkspaceSettings;
}

export interface ItemScope {
  /** Restrict to these item ids; undefined means every item. */
  itemIds?: Set<string>;
}

export interface Dataset {
  id: DatasetId;
  label: string;
  description: string;
  /** Whether narrowing to items applies. */
  itemScoped: boolean;
  build: (src: ExportSource, scope: ItemScope) => { headers: string[]; rows: Cell[][] };
  count: (src: ExportSource, scope: ItemScope) => number;
}

const inScope = (scope: ItemScope, itemId: string) => !scope.itemIds || scope.itemIds.has(itemId);
const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map((r) => [r.id, r]));
const name = <T extends { id: string; name: string }>(map: Map<string, T>, id?: string) => (id ? (map.get(id)?.name ?? id) : "");
const day = (iso?: string) => (iso ? iso.slice(0, 10) : "");

function itemRows(src: ExportSource, scope: ItemScope): Item[] {
  return src.data.items.filter((i) => inScope(scope, i.id));
}

export const DATASETS: Dataset[] = [
  {
    id: "items",
    label: "Items",
    description: "Every field on each item, with supplier and value.",
    itemScoped: true,
    count: (s, sc) => itemRows(s, sc).length,
    build: (src, scope) => {
      const suppliers = byId(src.data.suppliers);
      const headers = ["SKU", "Name", "Description", "Category", "Type", "Status", "On hand", "In transit", "Unit", "Min qty", "Max qty", "Unit cost", "Price", "Sale price", "Value", "Supplier", "Supplier SKU", "Lead time days", "Location", "Barcode", "Brand", "Weight", "Weight unit", "Tags", "Cross-references", "Superseded by", "Created", "Updated"];
      const items = byId(src.data.items);
      const rows = itemRows(src, scope).map((i) => [i.sku, i.name, i.description ?? "", i.category ?? "", i.type, i.status, i.onHand, i.inTransit ?? 0, i.unit, i.minQty ?? "", i.maxQty ?? "", i.unitCost, i.price, i.salePrice ?? "", round(i.onHand * i.unitCost), name(suppliers, i.supplierId), i.supplierSku ?? "", i.leadTimeDays ?? "", i.location ?? "", i.barcode ?? "", i.brand ?? "", i.weight ?? "", i.weightUnit ?? "", i.tags.join("; "), (i.crossRefs ?? []).map((r) => `${r.number} (${r.kind}${r.source ? ", " + r.source : ""})`).join("; "), i.supersededBy ? (items.get(i.supersededBy)?.sku ?? "") : "", day(i.createdAt), day(i.updatedAt)]);
      return { headers, rows };
    },
  },
  {
    id: "bom",
    label: "Bills of materials",
    description: "One row per component line of each assembly.",
    itemScoped: true,
    count: (s, sc) => itemRows(s, sc).reduce((a, i) => a + i.bom.length, 0),
    build: (src, scope) => {
      const items = byId(src.data.items);
      const rows: Cell[][] = [];
      for (const asm of itemRows(src, scope)) for (const l of asm.bom) rows.push([asm.sku, asm.name, items.get(l.itemId)?.sku ?? l.itemId, items.get(l.itemId)?.name ?? "", l.qty, l.wastePct ?? "", items.get(l.itemId)?.unitCost ?? "", round(l.qty * (items.get(l.itemId)?.unitCost ?? 0))]);
      return { headers: ["Assembly SKU", "Assembly", "Component SKU", "Component", "Qty per", "Waste %", "Component cost", "Line cost"], rows };
    },
  },
  {
    id: "stock",
    label: "Stock by location",
    description: "Quantity and bin of each item at each location.",
    itemScoped: true,
    count: (s, sc) => itemRows(s, sc).reduce((a, i) => a + Math.max(1, Object.keys(i.stock ?? {}).length), 0),
    build: (src, scope) => {
      const locations = byId(src.data.locations);
      const rows: Cell[][] = [];
      for (const i of itemRows(src, scope)) {
        const entries = i.stock ? Object.entries(i.stock) : [["loc_main", { qty: i.onHand, bin: i.location }] as const];
        for (const [locId, s] of entries) rows.push([i.sku, i.name, locations.get(locId)?.name ?? (locId === "loc_main" ? "Main" : locId), s.qty, s.bin ?? "", i.unitCost, round(s.qty * i.unitCost)]);
      }
      return { headers: ["SKU", "Name", "Location", "Qty", "Bin", "Unit cost", "Value"], rows };
    },
  },
  {
    id: "movements",
    label: "Stock movements (ledger)",
    description: "Every quantity change with its running balance.",
    itemScoped: true,
    count: (s, sc) => s.data.movements.filter((m) => inScope(sc, m.itemId)).length,
    build: (src, scope) => {
      const items = byId(src.data.items);
      const locations = byId(src.data.locations);
      const members = byId(src.data.members);
      const rows = src.data.movements
        .filter((m) => inScope(scope, m.itemId))
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
        .map((m) => [m.occurredAt, items.get(m.itemId)?.sku ?? m.itemId, items.get(m.itemId)?.name ?? "", m.type, m.qty, m.balanceAfter, m.unitCost ?? "", round(m.qty * (m.unitCost ?? 0)), m.locationId ? (locations.get(m.locationId)?.name ?? m.locationId) : "", m.refType ?? "", m.refId ?? "", m.reason ?? "", m.note ?? "", name(members, m.createdBy)]);
      return { headers: ["Occurred", "SKU", "Name", "Type", "Qty", "Balance after", "Unit cost", "Value", "Location", "Ref type", "Ref id", "Reason", "Note", "By"], rows };
    },
  },
  {
    id: "lots",
    label: "Lots / batches",
    description: "Batches on the shelf with what remains.",
    itemScoped: true,
    count: (s, sc) => s.data.lots.filter((l) => inScope(sc, l.itemId)).length,
    build: (src, scope) => {
      const items = byId(src.data.items);
      const rows = src.data.lots.filter((l) => inScope(scope, l.itemId)).map((l) => [items.get(l.itemId)?.sku ?? l.itemId, items.get(l.itemId)?.name ?? "", day(l.receivedAt), l.qtyReceived, l.qtyRemaining, l.unitCost, round(l.qtyRemaining * l.unitCost)]);
      return { headers: ["SKU", "Name", "Received", "Qty received", "Qty remaining", "Unit cost", "Remaining value"], rows };
    },
  },
  {
    id: "receipts",
    label: "Receipts",
    description: "Goods in, one row per receipt line.",
    itemScoped: true,
    count: (s, sc) => s.data.receipts.reduce((a, r) => a + r.lines.filter((l) => inScope(sc, l.itemId)).length, 0),
    build: (src, scope) => {
      const items = byId(src.data.items);
      const suppliers = byId(src.data.suppliers);
      const rows: Cell[][] = [];
      for (const r of src.data.receipts) for (const l of r.lines) if (inScope(scope, l.itemId)) rows.push([r.number, day(r.receivedAt), name(suppliers, r.supplierId), r.reference ?? "", items.get(l.itemId)?.sku ?? l.itemId, items.get(l.itemId)?.name ?? "", l.qty, l.unitCost ?? "", round(l.qty * (l.unitCost ?? 0))]);
      return { headers: ["Receipt", "Received", "Supplier", "Reference", "SKU", "Name", "Qty", "Unit cost", "Line cost"], rows };
    },
  },
  {
    id: "builds",
    label: "Builds",
    description: "Assemblies built and the components consumed.",
    itemScoped: true,
    count: (s, sc) => s.data.builds.filter((b) => inScope(sc, b.assemblyId)).length,
    build: (src, scope) => {
      const items = byId(src.data.items);
      const rows: Cell[][] = [];
      for (const b of src.data.builds) if (inScope(scope, b.assemblyId)) rows.push([b.number, day(b.createdAt), items.get(b.assemblyId)?.sku ?? b.assemblyId, items.get(b.assemblyId)?.name ?? "", b.qty, b.components.map((c) => `${items.get(c.itemId)?.sku ?? c.itemId} × ${c.qtyConsumed}`).join("; "), b.note ?? ""]);
      return { headers: ["Build", "Date", "Assembly SKU", "Assembly", "Qty built", "Components consumed", "Note"], rows };
    },
  },
  {
    id: "orders",
    label: "Sales orders",
    description: "One row per order line with what has shipped.",
    itemScoped: true,
    count: (s, sc) => s.data.orders.reduce((a, o) => a + o.lines.filter((l) => inScope(sc, l.itemId)).length, 0),
    build: (src, scope) => {
      const items = byId(src.data.items);
      const rows: Cell[][] = [];
      for (const o of src.data.orders) for (const l of o.lines) if (inScope(scope, l.itemId)) rows.push([o.number, day(o.createdAt), o.customer, o.customerEmail ?? "", o.status, o.source, o.externalRef ?? "", items.get(l.itemId)?.sku ?? l.itemId, items.get(l.itemId)?.name ?? "", l.qty, l.shipped ?? (o.status === "fulfilled" ? l.qty : 0), l.unitPrice, round(l.qty * l.unitPrice), day(o.fulfilledAt)]);
      return { headers: ["Order", "Created", "Customer", "Email", "Status", "Source", "External ref", "SKU", "Name", "Qty", "Shipped", "Unit price", "Line total", "Fulfilled"], rows };
    },
  },
  {
    id: "shipments",
    label: "Shipments",
    description: "Carrier, tracking and cost per shipment.",
    itemScoped: true,
    count: (s, sc) => s.data.shipments.filter((sh) => sh.lines.some((l) => inScope(sc, l.itemId))).length,
    build: (src, scope) => {
      const items = byId(src.data.items);
      const orders = byId(src.data.orders);
      const rows = src.data.shipments.filter((sh) => sh.lines.some((l) => inScope(scope, l.itemId))).map((sh) => [sh.number, day(sh.shippedAt), orders.get(sh.orderId)?.number ?? sh.orderId, orders.get(sh.orderId)?.customer ?? "", sh.carrier ?? "", sh.service ?? "", sh.trackingNumber ?? "", sh.trackingStatus ?? "", sh.cost ?? "", sh.currency ?? "", sh.lines.map((l) => `${items.get(l.itemId)?.sku ?? l.itemId} × ${l.qty}`).join("; ")]);
      return { headers: ["Shipment", "Shipped", "Order", "Customer", "Carrier", "Service", "Tracking", "Status", "Cost", "Currency", "Lines"], rows };
    },
  },
  {
    id: "transfers",
    label: "Transfers",
    description: "Stock moved between locations, line by line.",
    itemScoped: true,
    count: (s, sc) => s.data.transfers.reduce((a, t) => a + t.lines.filter((l) => inScope(sc, l.itemId)).length, 0),
    build: (src, scope) => {
      const items = byId(src.data.items);
      const locations = byId(src.data.locations);
      const rows: Cell[][] = [];
      for (const t of src.data.transfers) for (const l of t.lines) if (inScope(scope, l.itemId)) rows.push([t.number, day(t.shippedAt), locations.get(t.fromLocationId)?.name ?? t.fromLocationId, locations.get(t.toLocationId)?.name ?? t.toLocationId, t.status, items.get(l.itemId)?.sku ?? l.itemId, l.qty, l.receivedQty ?? "", day(t.receivedAt), t.carrier ?? "", t.trackingNumber ?? ""]);
      return { headers: ["Transfer", "Sent", "From", "To", "Status", "SKU", "Qty", "Received", "Received on", "Carrier", "Tracking"], rows };
    },
  },
  {
    id: "rmas",
    label: "Returns (RMAs)",
    description: "Returns with condition and disposition per line.",
    itemScoped: true,
    count: (s, sc) => s.data.rmas.reduce((a, r) => a + r.lines.filter((l) => inScope(sc, l.itemId)).length, 0),
    build: (src, scope) => {
      const items = byId(src.data.items);
      const rows: Cell[][] = [];
      for (const r of src.data.rmas) for (const l of r.lines) if (inScope(scope, l.itemId)) rows.push([r.number, day(r.createdAt), r.customer, r.status, r.reason, items.get(l.itemId)?.sku ?? l.itemId, l.qty, l.condition ?? "", (l as { disposition?: string }).disposition ?? ""]);
      return { headers: ["RMA", "Created", "Customer", "Status", "Reason", "SKU", "Qty", "Condition", "Disposition"], rows };
    },
  },
  {
    id: "quotes",
    label: "Quotes",
    description: "Quote lines with prices, costs and totals.",
    itemScoped: true,
    count: (s, sc) => s.data.quotes.reduce((a, q) => a + q.lines.filter((l) => !l.itemId || inScope(sc, l.itemId)).length, 0),
    build: (src, scope) => {
      const rows: Cell[][] = [];
      for (const q of src.data.quotes) {
        const t = quoteTotals(q);
        for (const l of q.lines) if (!l.itemId || inScope(scope, l.itemId)) rows.push([q.number, day(q.createdAt), q.customer, q.status, q.validUntil ?? "", l.kind, l.description, l.qty, l.unit ?? "", l.unitPrice, l.unitCost ?? "", l.discountPct ?? "", lineTotal(l), t.total, t.marginPct ?? ""]);
      }
      return { headers: ["Quote", "Created", "Customer", "Status", "Valid until", "Line kind", "Description", "Qty", "Unit", "Unit price", "Unit cost", "Discount %", "Line total", "Quote total", "Margin %"], rows };
    },
  },
  {
    id: "suppliers",
    label: "Suppliers",
    description: "Contact details, terms and lead times.",
    itemScoped: false,
    count: (s) => s.data.suppliers.length,
    build: (src) => ({ headers: ["Name", "Email", "Phone", "Lead time days", "Terms", "Items"], rows: src.data.suppliers.map((s) => [s.name, s.email ?? "", (s as { phone?: string }).phone ?? "", s.leadTimeDays ?? "", s.terms ?? "", src.data.items.filter((i) => i.supplierId === s.id).length]) }),
  },
  {
    id: "locations",
    label: "Locations",
    description: "Warehouses, stores, trucks and trailers.",
    itemScoped: false,
    count: (s) => s.data.locations.length,
    build: (src) => ({ headers: ["Name", "Code", "Kind", "Default", "Active"], rows: src.data.locations.map((l) => [l.name, l.code ?? "", l.kind, l.isDefault ? "yes" : "", l.active ? "yes" : "no"]) }),
  },
  {
    id: "activity",
    label: "Activity log",
    description: "Who did what, when.",
    itemScoped: false,
    count: (s) => s.data.activity.length,
    build: (src) => ({ headers: ["When", "Type", "Message", "By", "Entity type", "Entity id"], rows: [...src.data.activity].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((a) => [a.createdAt, a.type, a.message, a.actorName, a.entityType ?? "", a.entityId ?? ""]) }),
  },
];

export function datasetById(id: string): Dataset | undefined {
  return DATASETS.find((d) => d.id === id);
}
