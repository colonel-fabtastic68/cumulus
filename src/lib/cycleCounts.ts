import type { CycleCount, CycleCountLine, CycleCountScope, Item, Location, StockMovement } from "@/lib/types";
import type { Store, WriteOp } from "@/lib/store/types";
import { activityOp, adjustStock, defaultLocation, InventoryError, isLowStock, nextNumber, qtyAt, type Actor } from "@/lib/inventory";
import { newId, nowIso, round, sum } from "@/lib/utils";

/**
 * Cycle counts: count part of a location (a few bins, a category, a list of
 * items) against the ledger, then reconcile. Expected quantities are frozen
 * when the count starts; on completion each counted line becomes a "count"
 * movement at that location, so the shelf and the system agree again and the
 * difference is on record.
 */

export function binOf(item: Item, locationId: string, homeId: string): string | undefined {
  if (item.stock) return item.stock[locationId]?.bin?.trim() || undefined;
  return locationId === homeId ? item.location?.trim() || undefined : undefined;
}

/** Every bin in use at a location, most items first. */
export function binsAt(items: Item[], locationId: string, homeId: string): Array<{ bin: string; items: number }> {
  const counts = new Map<string, number>();
  for (const i of items) {
    if (i.status !== "active") continue;
    const b = binOf(i, locationId, homeId);
    if (b) counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([bin, n]) => ({ bin, items: n }))
    .sort((a, b) => b.items - a.items || a.bin.localeCompare(b.bin));
}

const norm = (s: string) => s.trim().toLowerCase();

/** The lines a count covers right now: expected = the system quantity at the location. */
export function buildCountLines(items: Item[], locationId: string, homeId: string, scope: CycleCountScope): CycleCountLine[] {
  const bins = new Set((scope.bins ?? []).map(norm));
  const ids = new Set(scope.itemIds ?? []);
  const lines: CycleCountLine[] = [];
  for (const item of items) {
    if (item.status !== "active" && !ids.has(item.id)) continue;
    const bin = binOf(item, locationId, homeId);
    const qty = qtyAt(item, locationId, homeId);
    let include = false;
    if (scope.kind === "location") include = qty !== 0 || !!bin;
    else if (scope.kind === "bins") include = !!bin && bins.has(norm(bin));
    else if (scope.kind === "category") include = norm(item.category ?? "") === norm(scope.category ?? "") && (qty !== 0 || !!bin);
    else if (scope.kind === "items") include = ids.has(item.id);
    if (include) lines.push({ itemId: item.id, bin, expected: qty });
  }
  return lines.sort((a, b) => (a.bin ?? "￿").localeCompare(b.bin ?? "￿") || (items.find((i) => i.id === a.itemId)?.sku ?? "").localeCompare(items.find((i) => i.id === b.itemId)?.sku ?? ""));
}

export function describeScope(scope: CycleCountScope): string {
  if (scope.kind === "bins") return `Bins ${(scope.bins ?? []).join(", ")}`;
  if (scope.kind === "category") return `Category ${scope.category ?? ""}`;
  if (scope.kind === "items") return `${(scope.itemIds ?? []).length} chosen items`;
  return "Whole location";
}

export function countProgress(count: CycleCount): { counted: number; total: number } {
  return { counted: count.lines.filter((l) => l.counted !== undefined).length, total: count.lines.length };
}

export function lineVariance(line: CycleCountLine): number | undefined {
  return line.counted === undefined ? undefined : round(line.counted - line.expected, 4);
}

export interface StartCountInput {
  locationId?: string;
  scope: CycleCountScope;
  name?: string;
  note?: string;
  blind?: boolean;
  source?: CycleCount["source"];
  /** Strato's expectations per item, kept beside the system quantity for the comparison afterwards. */
  proposals?: Array<{ itemId: string; proposed: number; note?: string }>;
}

export async function startCycleCount(store: Store, actor: Actor, input: StartCountInput): Promise<CycleCount> {
  const [items, locations] = await Promise.all([store.list("items"), store.list("locations")]);
  const home = defaultLocation(locations).location;
  const locationId = input.locationId || home.id;
  const location = locations.find((l) => l.id === locationId) ?? (locationId === home.id ? home : undefined);
  if (!location) throw new InventoryError("Unknown location");
  const lines = buildCountLines(items, locationId, home.id, input.scope);
  if (lines.length === 0) throw new InventoryError("Nothing to count: no active items match that scope at this location");
  const byItem = new Map((input.proposals ?? []).map((p) => [p.itemId, p]));
  for (const l of lines) {
    const p = byItem.get(l.itemId);
    if (p) {
      l.proposed = p.proposed;
      if (p.note) l.proposedNote = p.note;
    }
  }
  const { number, ops } = await nextNumber(store, "cycleCount");
  const now = nowIso();
  const count: CycleCount = {
    id: newId("cc"),
    number,
    name: input.name?.trim() || undefined,
    locationId,
    scope: input.scope,
    status: "open",
    lines,
    note: input.note?.trim() || undefined,
    source: input.source ?? "manual",
    blind: input.blind ?? false,
    createdAt: now,
    createdBy: actor.id,
  };
  ops.push({ op: "put", collection: "cycleCounts", doc: count });
  ops.push(activityOp(actor, "count.started", `${actor.name} started ${number}: ${describeScope(input.scope)} at ${location.name} · ${lines.length} line${lines.length === 1 ? "" : "s"}`, { entityType: "cycleCount", entityId: count.id, meta: { lines: lines.length, source: count.source } }));
  await store.batch(ops);
  return count;
}

export async function recordCounts(store: Store, actor: Actor, id: string, entries: Array<{ itemId: string; counted: number | null; note?: string }>): Promise<CycleCount> {
  const count = await store.get("cycleCounts", id);
  if (!count) throw new InventoryError("Count not found");
  if (count.status !== "open") throw new InventoryError(`${count.number} is ${count.status}`);
  const now = nowIso();
  const byItem = new Map(entries.map((e) => [e.itemId, e]));
  const lines = count.lines.map((l) => {
    const e = byItem.get(l.itemId);
    if (!e) return l;
    const next: CycleCountLine = { ...l };
    if (e.counted === null) {
      delete next.counted;
      delete next.countedAt;
      delete next.countedBy;
    } else {
      if (!Number.isFinite(e.counted) || e.counted < 0) throw new InventoryError("Counted quantities must be zero or more");
      next.counted = e.counted;
      next.countedAt = now;
      next.countedBy = actor.id;
    }
    if (e.note !== undefined) next.note = e.note.trim() || undefined;
    return next;
  });
  const unknown = entries.filter((e) => !count.lines.some((l) => l.itemId === e.itemId));
  if (unknown.length) throw new InventoryError(`${unknown.length} item${unknown.length === 1 ? " is" : "s are"} not on ${count.number}`);
  const next: CycleCount = { ...count, lines };
  await store.put("cycleCounts", next);
  return next;
}

/** Books a "count" movement for every counted line that differs from the system, then closes the count. */
export async function completeCycleCount(store: Store, actor: Actor, id: string, opts: { applyAdjustments?: boolean } = {}): Promise<CycleCount> {
  const count = await store.get("cycleCounts", id);
  if (!count) throw new InventoryError("Count not found");
  if (count.status !== "open") throw new InventoryError(`${count.number} is already ${count.status}`);
  const counted = count.lines.filter((l) => l.counted !== undefined);
  if (counted.length === 0) throw new InventoryError("Nothing has been counted yet");
  const [items, locations] = await Promise.all([store.list("items"), store.list("locations")]);
  const home = defaultLocation(locations).location;
  const byId = new Map(items.map((i) => [i.id, i]));
  // Reconcile against the quantity now, not the one frozen at the start, so movements booked during the count are not undone.
  const adjustments = counted
    .map((l) => ({ line: l, item: byId.get(l.itemId), current: byId.get(l.itemId) ? qtyAt(byId.get(l.itemId)!, count.locationId, home.id) : 0 }))
    .filter((x) => x.item && Math.abs(x.line.counted! - x.current) > 1e-9);
  const apply = opts.applyAdjustments !== false;
  if (apply && adjustments.length) {
    await adjustStock(
      store,
      actor,
      adjustments.map((x) => ({ itemId: x.item!.id, newQty: x.line.counted!, type: "count" as const, reason: `Cycle count ${count.number}${x.line.bin ? ` · bin ${x.line.bin}` : ""}`, note: x.line.note, refType: "count" as const, refId: count.id, locationId: count.locationId })),
    );
  }
  const varianceUnits = round(sum(adjustments.map((x) => x.line.counted! - x.current)), 4);
  const varianceValue = round(sum(adjustments.map((x) => (x.line.counted! - x.current) * (x.item?.unitCost ?? 0))));
  const now = nowIso();
  const next: CycleCount = { ...count, status: "completed", completedAt: now, completedBy: actor.id, result: { adjusted: apply ? adjustments.length : 0, varianceUnits, varianceValue, counted: counted.length } };
  const ops: WriteOp[] = [{ op: "put", collection: "cycleCounts", doc: next }];
  ops.push(activityOp(actor, "count.completed", `${actor.name} completed ${count.number}: ${counted.length} of ${count.lines.length} lines counted, ${adjustments.length} differed${apply ? " and were adjusted" : ""} (${varianceUnits >= 0 ? "+" : ""}${varianceUnits} units, ${varianceValue >= 0 ? "+" : "-"}$${Math.abs(varianceValue).toFixed(2)})`, { entityType: "cycleCount", entityId: count.id, meta: { ...next.result, changes: adjustments.slice(0, 300).map((x) => ({ sku: x.item!.sku, field: x.line.bin ? `on hand (bin ${x.line.bin})` : "on hand", from: x.current, to: x.line.counted })), changesTotal: adjustments.length } }));
  await store.batch(ops);
  return next;
}

export async function cancelCycleCount(store: Store, actor: Actor, id: string): Promise<void> {
  const count = await store.get("cycleCounts", id);
  if (!count) throw new InventoryError("Count not found");
  if (count.status !== "open") throw new InventoryError(`${count.number} is already ${count.status}`);
  await store.batch([
    { op: "patch", collection: "cycleCounts", id, patch: { status: "cancelled", cancelledAt: nowIso() } },
    activityOp(actor, "count.cancelled", `${actor.name} cancelled ${count.number}`, { entityType: "cycleCount", entityId: id }),
  ]);
}

// ---- proposals ---------------------------------------------------------------

export interface CountSuggestion {
  itemId: string;
  sku: string;
  name: string;
  bin?: string;
  expected: number;
  /** Why this item is worth counting now. */
  reasons: string[];
  /** 0-100, higher counts first. */
  priority: number;
  lastCountedAt?: string;
  movementsSinceCount: number;
}

/**
 * Which items deserve a count: never or long-ago counted, busy since the last
 * count, low or negative on paper, or high value on the shelf. Used by the
 * Suggest button and by Strato when asked to propose a count.
 */
export function suggestCountItems(items: Item[], movements: StockMovement[], locationId: string, homeId: string, counts: CycleCount[], opts: { limit?: number; now?: number } = {}): CountSuggestion[] {
  const now = opts.now ?? Date.now();
  const lastCounted = new Map<string, string>();
  for (const c of counts) {
    if (c.status !== "completed" || c.locationId !== locationId) continue;
    for (const l of c.lines) if (l.counted !== undefined && (!lastCounted.has(l.itemId) || lastCounted.get(l.itemId)! < c.completedAt!)) lastCounted.set(l.itemId, c.completedAt!);
  }
  for (const m of movements) if (m.type === "count" && (!m.locationId || m.locationId === locationId) && (!lastCounted.has(m.itemId) || lastCounted.get(m.itemId)! < m.occurredAt)) lastCounted.set(m.itemId, m.occurredAt);
  const out: CountSuggestion[] = [];
  for (const item of items) {
    if (item.status !== "active") continue;
    const expected = qtyAt(item, locationId, homeId);
    const bin = binOf(item, locationId, homeId);
    if (expected === 0 && !bin) continue;
    const since = lastCounted.get(item.id);
    const sinceMs = since ? now - new Date(since).getTime() : Infinity;
    const moves = movements.filter((m) => m.itemId === item.id && (!m.locationId || m.locationId === locationId) && (!since || m.occurredAt > since)).length;
    const reasons: string[] = [];
    let priority = 0;
    if (!since) {
      reasons.push("never counted");
      priority += 40;
    } else if (sinceMs > 90 * 86_400_000) {
      reasons.push(`last counted ${Math.round(sinceMs / 86_400_000)} days ago`);
      priority += 25;
    }
    if (moves >= 10) {
      reasons.push(`${moves} movements since`);
      priority += Math.min(25, moves);
    }
    if (expected < 0) {
      reasons.push("negative on paper");
      priority += 40;
    } else if (isLowStock(item)) {
      reasons.push("at or below minimum");
      priority += 15;
    }
    const value = expected * item.unitCost;
    if (value >= 1000) {
      reasons.push(`$${Math.round(value).toLocaleString()} on the shelf`);
      priority += 15;
    }
    if (reasons.length === 0) continue;
    out.push({ itemId: item.id, sku: item.sku, name: item.name, bin, expected, reasons, priority: Math.min(100, priority), lastCountedAt: since, movementsSinceCount: moves });
  }
  return out.sort((a, b) => b.priority - a.priority || a.sku.localeCompare(b.sku)).slice(0, opts.limit ?? 40);
}

export function locationName(locations: Location[], id: string): string {
  return locations.find((l) => l.id === id)?.name ?? defaultLocation(locations).location.name;
}
