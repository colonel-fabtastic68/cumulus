import type { Item, SalesOrder, Shipment, StockMovement } from "@/lib/types";
import { round } from "@/lib/utils";

/**
 * Factor 38: inventory KPIs from the ledger itself. Nothing is sampled or
 * estimated ahead of time; every number is recomputed from movements, orders
 * and shipments for the period asked for.
 */

const USAGE_TYPES = new Set<StockMovement["type"]>(["sale", "build_consume"]);
const DAY_MS = 86_400_000;

export interface FillRate {
  /** Units on the first shipment ÷ units ordered, or null without orders. */
  unitRate: number | null;
  orders: number;
  unitsOnFirstShipment: number;
  orderedUnits: number;
  linesInFull: number;
  lines: number;
}

export interface KpiRow {
  key: string;
  label: string;
  /** Units sold or consumed in builds during the period. */
  unitsUsed: number;
  /** Cost of those units at their movement cost. */
  cogs: number;
  /** Time-weighted on-hand value at standard cost across the period. */
  avgInventoryValue: number;
  /** Annualised: cogs ÷ average inventory × (365 ÷ days). */
  turnover: number | null;
  /** Current stock ÷ the period's daily usage. */
  daysOnHand: number | null;
  /** Usage movements that took the item to zero or below. */
  stockouts: number;
  /** On hand × unit cost now. */
  endingValue: number;
}

export interface KpiReport {
  period: { days: number; from: string; to: string };
  company: KpiRow & { fillRate: FillRate; itemsOutOfStock: number };
  byCategory: KpiRow[];
  bySku: KpiRow[];
}

interface Acc {
  unitsUsed: number;
  cogs: number;
  avgQty: number;
  stockouts: number;
  endingQty: number;
  unitCost: number;
}

function emptyRow(key: string, label: string): KpiRow {
  return { key, label, unitsUsed: 0, cogs: 0, avgInventoryValue: 0, turnover: null, daysOnHand: null, stockouts: 0, endingValue: 0 };
}

function finish(row: KpiRow, days: number): KpiRow {
  const turnover = row.avgInventoryValue > 0 ? (row.cogs / row.avgInventoryValue) * (365 / days) : null;
  const dailyCost = row.cogs / days;
  const daysOnHand = dailyCost > 0 ? row.endingValue / dailyCost : null;
  return {
    ...row,
    cogs: round(row.cogs),
    avgInventoryValue: round(row.avgInventoryValue),
    endingValue: round(row.endingValue),
    turnover: turnover === null ? null : round(turnover, 2),
    daysOnHand: daysOnHand === null ? null : round(daysOnHand, 1),
  };
}

/** Time-weighted average on-hand quantity over [from, to], rebuilt backwards from the current balance. */
function averageQty(item: Item, movements: StockMovement[], from: number, to: number): number {
  // Balance at the start of the window = now − everything that happened inside it.
  const inWindow = movements.filter((m) => new Date(m.occurredAt).getTime() > from).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  let balance = item.onHand - inWindow.reduce((a, m) => a + m.qty, 0);
  let cursor = from;
  let area = 0;
  for (const m of inWindow) {
    const t = Math.min(to, Math.max(from, new Date(m.occurredAt).getTime()));
    area += balance * (t - cursor);
    balance += m.qty;
    cursor = t;
  }
  area += balance * (to - cursor);
  const span = to - from;
  return span > 0 ? Math.max(0, area / span) : Math.max(0, item.onHand);
}

export function kpiReport(items: Item[], movements: StockMovement[], orders: SalesOrder[], shipments: Shipment[], opts: { days: number; now?: Date }): KpiReport {
  const days = Math.max(1, opts.days);
  const to = (opts.now ?? new Date()).getTime();
  const from = to - days * DAY_MS;
  const fromIso = new Date(from).toISOString();
  const toIso = new Date(to).toISOString();

  const byItem = new Map<string, StockMovement[]>();
  for (const m of movements) {
    const list = byItem.get(m.itemId);
    if (list) list.push(m);
    else byItem.set(m.itemId, [m]);
  }

  const perItem = new Map<string, Acc>();
  for (const item of items) {
    const list = byItem.get(item.id) ?? [];
    const acc: Acc = { unitsUsed: 0, cogs: 0, avgQty: 0, stockouts: 0, endingQty: Math.max(0, item.onHand), unitCost: item.unitCost };
    for (const m of list) {
      if (!USAGE_TYPES.has(m.type)) continue;
      const t = new Date(m.occurredAt).getTime();
      if (t <= from || t > to || m.qty >= 0) continue;
      const units = -m.qty;
      acc.unitsUsed += units;
      acc.cogs += units * (m.unitCost ?? item.unitCost);
      if (m.balanceAfter <= 0) acc.stockouts++;
    }
    acc.avgQty = averageQty(item, list, from, to);
    perItem.set(item.id, acc);
  }

  const company = emptyRow("company", "Company");
  const categories = new Map<string, KpiRow>();
  const skus: KpiRow[] = [];
  let itemsOutOfStock = 0;
  for (const item of items) {
    const acc = perItem.get(item.id)!;
    const row = emptyRow(item.id, item.sku);
    row.unitsUsed = acc.unitsUsed;
    row.cogs = acc.cogs;
    row.avgInventoryValue = acc.avgQty * acc.unitCost;
    row.stockouts = acc.stockouts;
    row.endingValue = acc.endingQty * acc.unitCost;
    if (item.status === "active" && item.onHand <= 0 && acc.unitsUsed > 0) itemsOutOfStock++;
    if (row.unitsUsed > 0 || row.avgInventoryValue > 0 || row.endingValue > 0) skus.push(finish(row, days));
    const catKey = item.category?.trim() || "Uncategorised";
    const cat = categories.get(catKey) ?? emptyRow(catKey, catKey);
    for (const target of [cat, company]) {
      target.unitsUsed += row.unitsUsed;
      target.cogs += row.cogs;
      target.avgInventoryValue += row.avgInventoryValue;
      target.stockouts += row.stockouts;
      target.endingValue += row.endingValue;
    }
    categories.set(catKey, cat);
  }

  return {
    period: { days, from: fromIso, to: toIso },
    company: { ...finish(company, days), fillRate: fillRate(orders, shipments, from, to), itemsOutOfStock },
    byCategory: Array.from(categories.values())
      .filter((r) => r.unitsUsed > 0 || r.avgInventoryValue > 0 || r.endingValue > 0)
      .map((r) => finish(r, days)),
    bySku: skus,
  };
}

/** Units on each order's first shipment against units ordered, for orders placed in the period. */
export function fillRate(orders: SalesOrder[], shipments: Shipment[], from: number, to: number): FillRate {
  const firstByOrder = new Map<string, Shipment>();
  for (const s of shipments) {
    const prev = firstByOrder.get(s.orderId);
    if (!prev || s.shippedAt < prev.shippedAt) firstByOrder.set(s.orderId, s);
  }
  const out: FillRate = { unitRate: null, orders: 0, unitsOnFirstShipment: 0, orderedUnits: 0, linesInFull: 0, lines: 0 };
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const t = new Date(o.createdAt).getTime();
    if (t <= from || t > to) continue;
    const first = firstByOrder.get(o.id);
    // Orders fulfilled before shipments were recorded count as shipped in full.
    const legacyFull = !first && o.status === "fulfilled";
    if (!first && !legacyFull) continue;
    out.orders++;
    for (const line of o.lines) {
      const shipped = legacyFull ? line.qty : first!.lines.filter((l) => l.itemId === line.itemId).reduce((a, l) => a + l.qty, 0);
      out.lines++;
      out.orderedUnits += line.qty;
      out.unitsOnFirstShipment += Math.min(line.qty, shipped);
      if (shipped >= line.qty) out.linesInFull++;
    }
  }
  out.unitRate = out.orderedUnits > 0 ? round(out.unitsOnFirstShipment / out.orderedUnits, 4) : null;
  return out;
}
