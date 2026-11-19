import type { Actor } from "@/lib/inventory";
import type { Build, Item, Lot, Serial, SerialEvent, SerialEventKind, SerialStatus, StockMovement } from "@/lib/types";
import { newId, nowIso, round } from "@/lib/utils";

/**
 * Serial numbers (feature `serials`): one record per physical unit of an item that
 * is tracked by unit.
 *
 * Quantities still move through the stock ledger exactly as before. The serial
 * says WHICH unit: it is created when its work order is released, becomes a
 * one-unit batch (lot) when the unit is finished, can be built into a bigger
 * serial-numbered unit, and is marked shipped when it leaves on an order. Its
 * history is a list of dated events that are only ever added to.
 *
 * Plain functions only; the writes live in src/lib/workOrders.ts (making units),
 * src/lib/inventory.ts (shipping them) and src/lib/serialActions.ts (notes).
 */

export const SERIAL_STATUS_LABEL: Record<SerialStatus, string> = {
  planned: "Planned",
  in_production: "In production",
  in_stock: "In stock",
  installed: "Built in",
  shipped: "Shipped",
  scrapped: "Scrapped",
  voided: "Cancelled",
};

/** Units still being made. */
export const SERIAL_UNFINISHED: SerialStatus[] = ["planned", "in_production"];

export const DEFAULT_SERIAL_FORMAT = "{SKU}-{####}";

export function isTracked(item: Pick<Item, "tracking"> | undefined): boolean {
  return item?.tracking === "serial";
}

/**
 * A serial number from the item's format: "{SKU}" is the item code and a run of # in braces is the
 * counter, zero-padded to that many digits. A format without a counter gets "-0001" added.
 */
export function formatSerial(format: string | undefined, sku: string, n: number): string {
  const f = format?.trim() || DEFAULT_SERIAL_FORMAT;
  const withSku = f.replace(/\{sku\}/gi, sku);
  const counter = withSku.match(/\{(#+)\}/);
  if (!counter) return `${withSku}-${String(n).padStart(4, "0")}`;
  return withSku.replace(counter[0], String(n).padStart(counter[1]!.length, "0"));
}

/** A dated line for a serial's history. */
export function serialEvent(
  actor: Actor,
  serialId: string,
  kind: SerialEventKind,
  text: string,
  extra: Partial<Pick<SerialEvent, "occurredAt" | "workOrderId" | "stepId" | "otherSerialId" | "orderId">> = {},
): SerialEvent {
  const now = nowIso();
  return { id: newId("sev"), serialId, kind, text, occurredAt: extra.occurredAt ?? now, ...extra, createdAt: now, createdBy: actor.id, createdByName: actor.name };
}

/**
 * New serials for an item, numbered from its counter and skipping numbers already used for it.
 * Returns the records, their "created" events and the counter to store back on the item.
 */
export function newSerials(
  item: Item,
  count: number,
  taken: Iterable<string>,
  base: Partial<Pick<Serial, "workOrderId" | "jobId" | "orderId" | "locationId" | "options">>,
  actor: Actor,
  reason: string,
): { serials: Serial[]; events: SerialEvent[]; serialNext: number } {
  const used = new Set(Array.from(taken, (n) => n.toUpperCase()));
  const serials: Serial[] = [];
  const events: SerialEvent[] = [];
  let n = item.serialNext ?? 1;
  const now = nowIso();
  while (serials.length < count) {
    const number = formatSerial(item.serialFormat, item.sku, n++);
    if (used.has(number.toUpperCase())) continue;
    used.add(number.toUpperCase());
    const serial: Serial = { id: newId("ser"), itemId: item.id, number, status: "planned", ...base, createdAt: now, updatedAt: now, createdBy: actor.id };
    serials.push(serial);
    events.push(serialEvent(actor, serial.id, "created", reason, { workOrderId: base.workOrderId }));
  }
  return { serials, events, serialNext: n };
}

/** Units of an item on the shelf, oldest finished first: the ones to build in or ship next. */
export function serialsInStock(serials: Serial[], itemId: string, locationId?: string, homeId?: string): Serial[] {
  return serials
    .filter((s) => s.itemId === itemId && s.status === "in_stock" && (locationId === undefined || (s.locationId ?? homeId) === locationId))
    .sort((a, b) => (a.finishedAt ?? a.createdAt).localeCompare(b.finishedAt ?? b.createdAt) || a.number.localeCompare(b.number, undefined, { numeric: true }));
}

/** A serial's history, oldest first. */
export function serialTimeline(events: SerialEvent[], serialId: string): SerialEvent[] {
  return events.filter((e) => e.serialId === serialId).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.createdAt.localeCompare(b.createdAt));
}

/** What the unit cost to make: its one-unit batch, which the build valued at the parts it consumed. */
export function serialCost(serial: Pick<Serial, "lotId">, lots: Lot[]): number | undefined {
  if (!serial.lotId) return undefined;
  return lots.find((l) => l.id === serial.lotId)?.unitCost;
}

export interface AsBuiltPart {
  itemId: string;
  qty: number;
  /** Which batches the parts came out of. */
  lots: Array<{ lotId: string; qty: number }>;
  /** Serial-numbered units of this part built in. */
  serials: Serial[];
}

/** What went into a unit: the parts its build consumed, the batches they came from, and the numbered units built in. */
export function asBuilt(serial: Pick<Serial, "id" | "buildId">, src: { builds: Build[]; movements: StockMovement[]; serials: Serial[] }): AsBuiltPart[] {
  const build = serial.buildId ? src.builds.find((b) => b.id === serial.buildId) : undefined;
  const children = src.serials.filter((s) => s.parentSerialId === serial.id);
  const parts = new Map<string, AsBuiltPart>();
  const part = (itemId: string) => {
    let p = parts.get(itemId);
    if (!p) {
      p = { itemId, qty: 0, lots: [], serials: [] };
      parts.set(itemId, p);
    }
    return p;
  };
  if (build) {
    for (const c of build.components) part(c.itemId).qty = c.qtyConsumed;
    for (const m of src.movements) {
      if (m.refId !== build.id || m.type !== "build_consume") continue;
      const p = part(m.itemId);
      for (const a of m.lots ?? []) p.lots.push({ lotId: a.lotId, qty: round(a.qty, 4) });
    }
  }
  for (const c of children) {
    const p = part(c.itemId);
    p.serials.push(c);
    if (!build) p.qty += 1;
  }
  return [...parts.values()];
}
