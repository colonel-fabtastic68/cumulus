import type { Item, StockMovement } from "@/lib/types";
import { reorderQty } from "@/lib/inventory";
import { round } from "@/lib/utils";

/**
 * Projections from the ledger: where stock, demand, value and cost are
 * heading for one SKU, a category, or the whole company. History is rebuilt
 * from movements; the forecast is the recent usage rate, optionally shaped by
 * last year's monthly pattern and by a growth assumption.
 */

export type ProjectionScope = { kind: "company" } | { kind: "category"; category: string } | { kind: "sku"; itemId: string };

export interface Scenario {
  /** Days ahead to project. */
  horizonDays: number;
  /** Days of history that set the usage rate (and are drawn). */
  historyDays: number;
  /** Demand change applied to the usage rate, e.g. 20 = 20% more than recent. */
  growthPct: number;
  /** Shape the forecast by each month's share of the last 12 months. */
  seasonality: boolean;
  /** List price drift across the horizon. */
  priceChangePct: number;
  /** Unit cost drift across the horizon, on top of the observed receipt-cost trend. */
  costChangePct: number;
}

export const DEFAULT_SCENARIO: Scenario = { horizonDays: 90, historyDays: 90, growthPct: 0, seasonality: true, priceChangePct: 0, costChangePct: 0 };

const DAY = 86_400_000;
const USAGE = new Set<StockMovement["type"]>(["sale", "build_consume"]);

export interface ItemProjection {
  item: Item;
  /** Units per day, after growth. */
  dailyUsage: number;
  daysOfCover: number | null;
  /** First projected day at or below zero. */
  stockoutDate?: string;
  /** Day the projected level reaches the minimum; place the order lead-time days before it. */
  reorderByDate?: string;
  reorderQty: number;
  onHandAtHorizon: number;
  costNow: number;
  costAtHorizon: number;
  priceNow: number;
  priceAtHorizon: number;
  /** Projected on-hand per day, index 0 = tomorrow. */
  path: number[];
}

export interface Projection {
  /** ISO dates for every point: history then projection. */
  dates: string[];
  /** Index of the first projected point. */
  splitIndex: number;
  onHand: Array<number | null>;
  value: Array<number | null>;
  /** Monthly demand: actual months then projected months. */
  demand: { labels: string[]; values: Array<number | null>; projectedFrom: number };
  /** For one SKU: unit cost from receipts over time and its projection; list price and its projection. */
  cost?: Array<number | null>;
  price?: Array<number | null>;
  perItem: ItemProjection[];
  summary: {
    items: number;
    onHandNow: number;
    onHandAtHorizon: number;
    valueNow: number;
    valueAtHorizon: number;
    dailyUsage: number;
    daysOfCover: number | null;
    stockoutsWithinHorizon: number;
    reordersWithinHorizon: number;
    seasonalityApplied: boolean;
  };
}

function dayIndex(iso: string, origin: number): number {
  return Math.floor((new Date(iso).getTime() - origin) / DAY);
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Month share index: this month's usage ÷ the average month over the last 12, from every usage movement in scope. */
function seasonalIndex(movements: StockMovement[], now: number): (month: number) => number {
  const byMonth = new Array<number>(12).fill(0);
  const yearAgo = now - 365 * DAY;
  let total = 0;
  let monthsWithData = 0;
  const seen = new Set<string>();
  for (const m of movements) {
    if (!USAGE.has(m.type) || m.qty >= 0) continue;
    const t = new Date(m.occurredAt);
    if (t.getTime() < yearAgo || t.getTime() > now) continue;
    byMonth[t.getMonth()]! += -m.qty;
    total += -m.qty;
    seen.add(`${t.getFullYear()}-${t.getMonth()}`);
  }
  monthsWithData = seen.size;
  if (monthsWithData < 6 || total === 0) return () => 1;
  const avg = total / 12;
  return (month) => (avg > 0 ? Math.max(0.2, Math.min(3, byMonth[month]! / avg)) : 1);
}

function linearTrend(points: Array<[number, number]>): { slope: number; intercept: number } | null {
  if (points.length < 2) return null;
  const n = points.length;
  const mx = points.reduce((a, p) => a + p[0], 0) / n;
  const my = points.reduce((a, p) => a + p[1], 0) / n;
  let num = 0;
  let den = 0;
  for (const [x, y] of points) {
    num += (x - mx) * (y - my);
    den += (x - mx) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  return { slope, intercept: my - slope * mx };
}

export function scopeItems(items: Item[], scope: ProjectionScope): Item[] {
  if (scope.kind === "sku") return items.filter((i) => i.id === scope.itemId);
  if (scope.kind === "category") return items.filter((i) => (i.category ?? "Uncategorised") === scope.category);
  return items.filter((i) => i.status === "active");
}

export function project(items: Item[], movements: StockMovement[], scope: ProjectionScope, scenario: Scenario, now = Date.now()): Projection {
  const inScope = scopeItems(items, scope);
  const ids = new Set(inScope.map((i) => i.id));
  const scoped = movements.filter((m) => ids.has(m.itemId));
  const todayStart = new Date(isoDay(now) + "T00:00:00Z").getTime();
  const H = Math.max(7, Math.round(scenario.historyDays));
  const F = Math.max(7, Math.round(scenario.horizonDays));
  const origin = todayStart - H * DAY;
  const season = scenario.seasonality ? seasonalIndex(scoped, now) : () => 1;
  const growth = 1 + scenario.growthPct / 100;

  // Daily deltas per item across the history window, so balances can be rebuilt backwards from today's on-hand.
  const deltas = new Map<string, number[]>();
  const usage = new Map<string, number>();
  for (const m of scoped) {
    const d = dayIndex(m.occurredAt, origin);
    if (d < 0 || d > H) continue;
    const arr = deltas.get(m.itemId) ?? new Array<number>(H + 1).fill(0);
    arr[d]! += m.qty;
    deltas.set(m.itemId, arr);
    if (USAGE.has(m.type) && m.qty < 0) usage.set(m.itemId, (usage.get(m.itemId) ?? 0) - m.qty);
  }

  const dates: string[] = [];
  for (let d = 0; d <= H + F; d++) dates.push(isoDay(origin + d * DAY));
  const splitIndex = H + 1;

  const onHandSeries = new Array<number>(H + F + 1).fill(0);
  const valueSeries = new Array<number>(H + F + 1).fill(0);
  const perItem: ItemProjection[] = [];
  const monthlyProjected = new Map<string, number>();

  for (const item of inScope) {
    const arr = deltas.get(item.id) ?? new Array<number>(H + 1).fill(0);
    // balance at end of day d = today's on-hand minus everything that happened after day d.
    const hist = new Array<number>(H + 1).fill(0);
    let after = 0;
    for (let d = H; d >= 0; d--) {
      hist[d] = item.onHand - after;
      after += arr[d]!;
    }
    const dailyUsage = ((usage.get(item.id) ?? 0) / H) * growth;
    const path: number[] = [];
    let level = item.onHand;
    let stockoutDate: string | undefined;
    let reorderByDate: string | undefined;
    for (let t = 1; t <= F; t++) {
      const ms = todayStart + t * DAY;
      const use = dailyUsage * season(new Date(ms).getUTCMonth());
      level = Math.max(0, level - use);
      path.push(level);
      const key = isoDay(ms).slice(0, 7);
      monthlyProjected.set(key, (monthlyProjected.get(key) ?? 0) + use);
      if (!stockoutDate && level <= 0 && dailyUsage > 0) stockoutDate = isoDay(ms);
      if (!reorderByDate && item.minQty !== undefined && level <= item.minQty && dailyUsage > 0) {
        const lead = item.leadTimeDays ?? 0;
        reorderByDate = isoDay(Math.max(todayStart, ms - lead * DAY));
      }
    }
    const costDrift = 1 + scenario.costChangePct / 100;
    const priceDrift = 1 + scenario.priceChangePct / 100;
    const costTrend = linearTrend(scoped.filter((m) => m.itemId === item.id && m.type === "receipt" && m.unitCost !== undefined && new Date(m.occurredAt).getTime() > now - 365 * DAY).map((m) => [dayIndex(m.occurredAt, origin), m.unitCost!] as [number, number]));
    const trendedCost = costTrend ? Math.max(0, costTrend.intercept + costTrend.slope * (H + F)) : item.unitCost;
    const costAtHorizon = round((costTrend && Math.abs(trendedCost - item.unitCost) < item.unitCost ? trendedCost : item.unitCost) * costDrift, 4);
    perItem.push({
      item,
      dailyUsage: round(dailyUsage, 3),
      daysOfCover: dailyUsage > 0 ? round(item.onHand / dailyUsage, 1) : null,
      stockoutDate,
      reorderByDate,
      reorderQty: reorderQty(item),
      onHandAtHorizon: round(path[path.length - 1] ?? item.onHand, 2),
      costNow: item.unitCost,
      costAtHorizon,
      priceNow: item.price,
      priceAtHorizon: round(item.price * priceDrift, 2),
      path,
    });
    for (let d = 0; d <= H; d++) {
      onHandSeries[d] += hist[d]!;
      valueSeries[d] += hist[d]! * item.unitCost;
    }
    for (let t = 1; t <= F; t++) {
      const c = item.unitCost + (costAtHorizon - item.unitCost) * (t / F);
      onHandSeries[H + t] += path[t - 1]!;
      valueSeries[H + t] += path[t - 1]! * c;
    }
  }

  // Monthly demand: the last 12 months from the ledger, then the projected months.
  const labels: string[] = [];
  const values: Array<number | null> = [];
  const monthKey = (ms: number) => isoDay(ms).slice(0, 7);
  const actualByMonth = new Map<string, number>();
  for (const m of scoped) {
    if (!USAGE.has(m.type) || m.qty >= 0) continue;
    const t = new Date(m.occurredAt).getTime();
    if (t < now - 365 * DAY || t > now) continue;
    actualByMonth.set(monthKey(t), (actualByMonth.get(monthKey(t)) ?? 0) + -m.qty);
  }
  const start = new Date(now);
  start.setUTCDate(1);
  start.setUTCMonth(start.getUTCMonth() - 11);
  for (let k = 0; k < 12; k++) {
    const d = new Date(start);
    d.setUTCMonth(start.getUTCMonth() + k);
    const key = monthKey(d.getTime());
    labels.push(key);
    values.push(round(actualByMonth.get(key) ?? 0, 1));
  }
  const projectedFrom = labels.length;
  const projectedKeys = Array.from(monthlyProjected.keys()).sort();
  for (const key of projectedKeys) {
    if (labels.includes(key)) {
      // The current month is partly actual, partly projected: add the projection to it.
      values[labels.indexOf(key)] = round((values[labels.indexOf(key)] ?? 0) + (monthlyProjected.get(key) ?? 0), 1);
      continue;
    }
    labels.push(key);
    values.push(round(monthlyProjected.get(key) ?? 0, 1));
  }

  let cost: Array<number | null> | undefined;
  let price: Array<number | null> | undefined;
  if (scope.kind === "sku" && inScope[0]) {
    const item = inScope[0];
    const receipts = scoped.filter((m) => m.type === "receipt" && m.unitCost !== undefined).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    cost = new Array<number | null>(H + F + 1).fill(null);
    let last: number | null = null;
    let r = 0;
    for (let d = 0; d <= H; d++) {
      while (r < receipts.length && dayIndex(receipts[r]!.occurredAt, origin) <= d) {
        last = receipts[r]!.unitCost!;
        r++;
      }
      cost[d] = last ?? item.unitCost;
    }
    const pi = perItem[0]!;
    for (let t = 1; t <= F; t++) cost[H + t] = round(item.unitCost + (pi.costAtHorizon - item.unitCost) * (t / F), 4);
    price = new Array<number | null>(H + F + 1).fill(null);
    for (let d = 0; d <= H; d++) price[d] = item.price;
    for (let t = 1; t <= F; t++) price[H + t] = round(item.price + (pi.priceAtHorizon - item.price) * (t / F), 2);
  }

  const dailyUsageTotal = perItem.reduce((a, p) => a + p.dailyUsage, 0);
  const onHandNow = onHandSeries[H] ?? 0;
  return {
    dates,
    splitIndex,
    onHand: onHandSeries.map((v) => round(v, 2)),
    value: valueSeries.map((v) => round(v, 2)),
    demand: { labels, values, projectedFrom },
    cost,
    price,
    perItem: perItem.sort((a, b) => (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity)),
    summary: {
      items: inScope.length,
      onHandNow: round(onHandNow, 2),
      onHandAtHorizon: round(onHandSeries[H + F] ?? 0, 2),
      valueNow: round(valueSeries[H] ?? 0, 2),
      valueAtHorizon: round(valueSeries[H + F] ?? 0, 2),
      dailyUsage: round(dailyUsageTotal, 3),
      daysOfCover: dailyUsageTotal > 0 ? round(onHandNow / dailyUsageTotal, 1) : null,
      stockoutsWithinHorizon: perItem.filter((p) => p.stockoutDate).length,
      reordersWithinHorizon: perItem.filter((p) => p.reorderByDate).length,
      seasonalityApplied: scenario.seasonality && season(0) !== 1 ? true : scenario.seasonality && Array.from({ length: 12 }, (_, m) => season(m)).some((v) => v !== 1),
    },
  };
}

/** A scenario Nimbus can fill in from a sentence. Anything left out keeps the current value. */
export interface ScenarioRequest {
  horizonDays?: number;
  historyDays?: number;
  growthPct?: number;
  seasonality?: boolean;
  priceChangePct?: number;
  costChangePct?: number;
  /** "company", a category name, or a SKU to switch the scope to. */
  scope?: { kind: "company" } | { kind: "category"; category: string } | { kind: "sku"; sku: string };
  /** One line saying how the sentence was read. */
  reading: string;
}
