import type { Item, SalesOrder, StockMovement } from "@/lib/types";
import { rolledUpCost } from "@/lib/inventory";
import { round } from "@/lib/utils";

/**
 * Live margin analysis: what each part actually earned over a window. Every
 * shipped unit is a sale movement in the ledger that points at its order, so
 * revenue is the movement's units at the order line's price and cost is the
 * cost recorded on the movement (the standard cost at the time). A later cost
 * change does not rewrite history.
 */

export interface MarginRow {
  item: Item;
  units: number;
  revenue: number;
  cogs: number;
  margin: number;
  /** Gross margin as a fraction of revenue; null when nothing was sold. */
  marginPct: number | null;
  avgPrice: number | null;
  avgCost: number | null;
  /** What the item would earn per unit at today's list price and cost. */
  listMarginPct: number | null;
  orders: number;
}

export interface MarginGroup {
  key: string;
  label: string;
  units: number;
  revenue: number;
  cogs: number;
  margin: number;
  marginPct: number | null;
  items: number;
}

export interface MarginReport {
  rows: MarginRow[];
  byCategory: MarginGroup[];
  total: MarginGroup;
  from: string;
  to: string;
}

const DAY_MS = 86_400_000;

export function marginReport(items: Item[], orders: SalesOrder[], movements: StockMovement[], days: number, now = Date.now()): MarginReport {
  const from = now - Math.max(1, days) * DAY_MS;
  const fromIso = new Date(from).toISOString();
  const toIso = new Date(now).toISOString();
  const byId = new Map(items.map((i) => [i.id, i]));
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const acc = new Map<string, { units: number; revenue: number; cogs: number; orders: Set<string> }>();
  for (const m of movements) {
    if (m.type !== "sale" || m.qty >= 0 || m.occurredAt < fromIso || m.occurredAt > toIso) continue;
    // Components consumed for a built-to-order assembly are costed on the assembly's own movement.
    if (m.note?.startsWith("Component of")) continue;
    const item = byId.get(m.itemId);
    if (!item) continue;
    const order = m.refType === "order" && m.refId ? orderById.get(m.refId) : undefined;
    const price = order?.lines.find((ol) => ol.itemId === m.itemId)?.unitPrice ?? item.price;
    const units = -m.qty;
    // A built-to-order assembly's movement carries its standard cost; the rolled-up BOM cost is truer when it has one.
    const unitCost = m.unitCost ?? (item.bom.length ? rolledUpCost(items, item) : item.unitCost);
    let a = acc.get(m.itemId);
    if (!a) {
      a = { units: 0, revenue: 0, cogs: 0, orders: new Set() };
      acc.set(m.itemId, a);
    }
    a.units += units;
    a.revenue += units * price;
    a.cogs += units * unitCost;
    if (order) a.orders.add(order.id);
  }

  const rows: MarginRow[] = [];
  for (const [itemId, a] of acc) {
    const item = byId.get(itemId);
    if (!item || a.units === 0) continue;
    const cogs = round(a.cogs);
    const revenue = round(a.revenue);
    const margin = round(revenue - cogs);
    const listCost = item.bom.length ? rolledUpCost(items, item) : item.unitCost;
    rows.push({
      item,
      units: a.units,
      revenue,
      cogs,
      margin,
      marginPct: revenue > 0 ? margin / revenue : null,
      avgPrice: a.units > 0 ? round(revenue / a.units, 4) : null,
      avgCost: a.units > 0 ? round(cogs / a.units, 4) : null,
      listMarginPct: item.price > 0 ? (item.price - listCost) / item.price : null,
      orders: a.orders.size,
    });
  }
  rows.sort((x, y) => y.margin - x.margin);

  const groups = new Map<string, MarginGroup>();
  const total: MarginGroup = { key: "total", label: "All items", units: 0, revenue: 0, cogs: 0, margin: 0, marginPct: null, items: rows.length };
  for (const r of rows) {
    const key = r.item.category ?? "Uncategorized";
    const g = groups.get(key) ?? { key, label: key, units: 0, revenue: 0, cogs: 0, margin: 0, marginPct: null, items: 0 };
    g.units += r.units;
    g.revenue = round(g.revenue + r.revenue);
    g.cogs = round(g.cogs + r.cogs);
    g.margin = round(g.margin + r.margin);
    g.items++;
    groups.set(key, g);
    total.units += r.units;
    total.revenue = round(total.revenue + r.revenue);
    total.cogs = round(total.cogs + r.cogs);
    total.margin = round(total.margin + r.margin);
  }
  const byCategory = Array.from(groups.values())
    .map((g) => ({ ...g, marginPct: g.revenue > 0 ? g.margin / g.revenue : null }))
    .sort((a, b) => b.revenue - a.revenue);
  total.marginPct = total.revenue > 0 ? total.margin / total.revenue : null;
  return { rows, byCategory, total, from: fromIso, to: toIso };
}
