/**
 * Pure, time-aware helpers for the home dashboard. Kept out of components so
 * render bodies stay pure and the numbers are easy to unit test.
 */
import type { Item, Lot, Rma, SalesOrder, StockMovement, WorkspaceSettings } from "@/lib/types";
import { deadStockReport, shelfLifeReport } from "@/lib/inventory";
import { sum } from "@/lib/utils";

const DAY = 86_400_000;

export function greetingFor(name: string, date: Date = new Date()): string {
  const h = date.getHours();
  const part = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const first = name.trim().split(/\s+/)[0] || "there";
  return `${part}, ${first}`;
}

export function todayLabel(date: Date = new Date()): string {
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Orders & returns
// ---------------------------------------------------------------------------

export function isOpenOrder(o: SalesOrder): boolean {
  return o.status === "open";
}

export function isOpenRma(r: Rma): boolean {
  return r.status === "open" || r.status === "inspecting";
}

export function orderUnits(o: SalesOrder): number {
  return sum(o.lines.map((l) => l.qty));
}

export function rmaUnits(r: Rma): number {
  return sum(r.lines.map((l) => l.qty));
}

/** True when at least one line cannot be shipped from what is on the shelf right now. */
export function orderIsShort(o: SalesOrder, byId: Map<string, Item>): boolean {
  return o.lines.some((l) => (byId.get(l.itemId)?.onHand ?? 0) < l.qty);
}

// ---------------------------------------------------------------------------
// Shipped units, current vs prior window
// ---------------------------------------------------------------------------

export interface ShippedWindow {
  current: number;
  prior: number;
  /** Percentage change vs the prior window, or null when the prior window had no sales. */
  changePct: number | null;
}

export function shippedUnits(movements: StockMovement[], days = 30, now: number = Date.now()): ShippedWindow {
  const start = now - days * DAY;
  const priorStart = now - 2 * days * DAY;
  let current = 0;
  let prior = 0;
  for (const m of movements) {
    if (m.type !== "sale" || m.qty >= 0) continue;
    const t = new Date(m.occurredAt).getTime();
    if (Number.isNaN(t)) continue;
    if (t >= start) current += -m.qty;
    else if (t >= priorStart) prior += -m.qty;
  }
  const changePct = prior > 0 ? Math.round(((current - prior) / prior) * 100) : null;
  return { current, prior, changePct };
}

// ---------------------------------------------------------------------------
// Weekly shipped vs built
// ---------------------------------------------------------------------------

export interface WeekBucket {
  key: string;
  /** Short label for the axis, e.g. "Jun 15". */
  label: string;
  isoWeek: number;
  start: Date;
  shipped: number;
  built: number;
}

function startOfIsoWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const offset = (x.getDay() + 6) % 7; // Monday = 0
  x.setDate(x.getDate() - offset);
  return x;
}

function isoWeekNumber(d: Date): number {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = x.getUTCDay() || 7;
  x.setUTCDate(x.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(x.getUTCFullYear(), 0, 1);
  return Math.ceil(((x.getTime() - yearStart) / DAY + 1) / 7);
}

/** Sale units and build_produce units per ISO week for the trailing `weeks` weeks (oldest first). */
export function weeklyShippedVsBuilt(movements: StockMovement[], weeks = 12, now: Date = new Date()): WeekBucket[] {
  const thisWeek = startOfIsoWeek(now);
  const buckets: WeekBucket[] = [];
  const index = new Map<number, WeekBucket>();
  for (let i = weeks - 1; i >= 0; i--) {
    const start = new Date(thisWeek);
    start.setDate(thisWeek.getDate() - i * 7);
    const bucket: WeekBucket = {
      key: start.toISOString(),
      label: start.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      isoWeek: isoWeekNumber(start),
      start,
      shipped: 0,
      built: 0,
    };
    buckets.push(bucket);
    index.set(start.getTime(), bucket);
  }
  for (const m of movements) {
    if (m.type !== "sale" && m.type !== "build_produce") continue;
    const d = new Date(m.occurredAt);
    if (Number.isNaN(d.getTime())) continue;
    const bucket = index.get(startOfIsoWeek(d).getTime());
    if (!bucket) continue;
    if (m.type === "sale") bucket.shipped += Math.max(0, -m.qty);
    else bucket.built += Math.max(0, m.qty);
  }
  return buckets;
}

/** Round a chart maximum up to a friendly axis value. */
export function niceCeil(n: number): number {
  if (n <= 10) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  const f = n / p;
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return m * p;
}

// ---------------------------------------------------------------------------
// Agent suggestions
// ---------------------------------------------------------------------------

function topSellingAssembly(items: Item[], movements: StockMovement[], days: number, now: number = Date.now()): Item | undefined {
  const since = now - days * DAY;
  const byId = new Map(items.map((i) => [i.id, i]));
  const sold = new Map<string, number>();
  for (const m of movements) {
    if (m.type !== "sale" || m.qty >= 0) continue;
    if (new Date(m.occurredAt).getTime() < since) continue;
    const item = byId.get(m.itemId);
    if (!item || item.type !== "assembly" || item.bom.length === 0) continue;
    sold.set(item.id, (sold.get(item.id) ?? 0) + -m.qty);
  }
  let best: Item | undefined;
  let bestQty = 0;
  for (const [id, qty] of sold) {
    if (qty > bestQty) {
      bestQty = qty;
      best = byId.get(id);
    }
  }
  return best ?? items.find((i) => i.status === "active" && i.type === "assembly" && i.bom.length > 0);
}

export interface SuggestionInput {
  items: Item[];
  movements: StockMovement[];
  lots: Lot[];
  openOrders: SalesOrder[];
  lowCount: number;
  settings: WorkspaceSettings;
}

/** Four context-aware prompts, most urgent first. */
export function agentSuggestions({ items, movements, lots, openOrders, lowCount, settings }: SuggestionInput): string[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: string[] = [];

  if (lowCount > 0) {
    out.push(`Draft reorder quantities for the ${lowCount} ${lowCount === 1 ? "item" : "items"} below minimum, grouped by supplier`);
  }

  const shortOrders = openOrders.filter((o) => orderIsShort(o, byId));
  if (shortOrders.length === 1) {
    out.push(`${shortOrders[0]!.number} is short on stock. What do I need to build or receive to ship it?`);
  } else if (shortOrders.length > 1) {
    out.push(`${shortOrders.length} open orders are short on stock. What do I need to build or receive to ship them?`);
  }

  const top = topSellingAssembly(items, movements, 90);
  if (top) out.push(`How many ${top.sku} can I build right now and what is the bottleneck?`);

  const days = settings.inactivityDays || 120;
  const dead = deadStockReport(items, movements, days).length;
  out.push(dead > 0 ? `Which ${dead} items have not moved in ${days} days?` : `Which items have not moved in ${days} days?`);

  const shelf = shelfLifeReport(items, lots);
  const oldest = shelf[0];
  out.push(oldest ? `Show the oldest batches on the shelf. ${oldest.item.sku} has been sitting for ${oldest.oldestDays} days.` : "Show the oldest batches on the shelf");

  out.push("Project next month's demand for finished goods using seasonality");
  out.push("Summarise inventory health for this week in three bullet points");

  return out.slice(0, 4);
}
