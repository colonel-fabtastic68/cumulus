import type { CostingMethod, Item, Lot, StockMovement } from "@/lib/types";
import { round, sum } from "@/lib/utils";

/**
 * Inventory valuation under the workspace's costing method. Standard and
 * average value the shelf at the item's unit cost (which the receipts keep
 * current); FIFO values each remaining batch at its own cost. The ledger
 * carries a cost on every movement, so the value at any past date and the
 * cost of goods sold over any window come straight from it.
 */

export const COSTING_LABELS: Record<CostingMethod, string> = { standard: "Standard cost", average: "Average cost", fifo: "FIFO" };

export interface ValuedItem {
  item: Item;
  onHand: number;
  /** Value per unit under the method (FIFO: the average of the remaining layers). */
  unitValue: number;
  value: number;
  /** Remaining batches, oldest first (FIFO layers). */
  layers: Lot[];
  /** Units no batch covers (stock that pre-dates batches), valued at the item's cost. */
  uncovered: number;
}

export function valueItems(items: Item[], lots: Lot[], method: CostingMethod): ValuedItem[] {
  const byItem = new Map<string, Lot[]>();
  for (const l of lots) {
    if (l.qtyRemaining <= 0) continue;
    (byItem.get(l.itemId) ?? byItem.set(l.itemId, []).get(l.itemId)!).push(l);
  }
  const out: ValuedItem[] = [];
  for (const item of items) {
    if (item.onHand <= 0) continue;
    const layers = (byItem.get(item.id) ?? []).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    if (method === "fifo") {
      const covered = Math.min(item.onHand, sum(layers.map((l) => l.qtyRemaining)));
      const uncovered = round(Math.max(0, item.onHand - covered), 3);
      // Layers can exceed on hand after a count down that was never relieved; value only what is on the shelf.
      let left = item.onHand;
      let value = 0;
      for (const l of layers) {
        const take = Math.min(left, l.qtyRemaining);
        value += take * l.unitCost;
        left -= take;
        if (left <= 0) break;
      }
      value += uncovered * item.unitCost;
      out.push({ item, onHand: item.onHand, unitValue: round(value / item.onHand, 4), value: round(value), layers, uncovered });
    } else {
      out.push({ item, onHand: item.onHand, unitValue: item.unitCost, value: round(item.onHand * item.unitCost), layers, uncovered: 0 });
    }
  }
  return out.sort((a, b) => b.value - a.value || a.item.sku.localeCompare(b.item.sku));
}

export function totalValue(rows: ValuedItem[]): number {
  return round(sum(rows.map((r) => r.value)));
}

export interface ValueAtDate {
  itemId: string;
  qty: number;
  value: number;
}

/**
 * Perpetual valuation from the ledger: every movement up to the date, at the
 * cost it carried. Movements without a cost (early data) use the item's cost.
 */
export function inventoryValueAt(items: Item[], movements: StockMovement[], dateIso: string): ValueAtDate[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const acc = new Map<string, ValueAtDate>();
  for (const m of movements) {
    if (m.occurredAt > dateIso) continue;
    const item = byId.get(m.itemId);
    if (!item) continue;
    const cost = m.unitCost ?? item.unitCost;
    const row = acc.get(m.itemId) ?? { itemId: m.itemId, qty: 0, value: 0 };
    row.qty = round(row.qty + m.qty, 3);
    row.value = round(row.value + m.qty * cost, 4);
    acc.set(m.itemId, row);
  }
  return Array.from(acc.values()).map((r) => ({ ...r, value: round(Math.max(0, r.value)) }));
}

export interface CogsSummary {
  units: number;
  cogs: number;
  byItem: Array<{ itemId: string; units: number; cogs: number }>;
}

/** Cost of goods sold between two dates: every sale movement at the cost it carried. */
export function cogsBetween(movements: StockMovement[], fromIso: string, toIso: string): CogsSummary {
  const by = new Map<string, { units: number; cogs: number }>();
  for (const m of movements) {
    if (m.type !== "sale" || m.qty >= 0 || m.occurredAt < fromIso || m.occurredAt > toIso) continue;
    const row = by.get(m.itemId) ?? { units: 0, cogs: 0 };
    row.units = round(row.units - m.qty, 3);
    row.cogs = round(row.cogs - m.qty * (m.unitCost ?? 0), 4);
    by.set(m.itemId, row);
  }
  const byItem = Array.from(by, ([itemId, r]) => ({ itemId, units: r.units, cogs: round(r.cogs) })).sort((a, b) => b.cogs - a.cogs);
  return { units: round(sum(byItem.map((r) => r.units)), 3), cogs: round(sum(byItem.map((r) => r.cogs))), byItem };
}

/** Receipts between two dates: units and value booked in. */
export function receiptsBetween(movements: StockMovement[], fromIso: string, toIso: string): { units: number; value: number } {
  const rows = movements.filter((m) => m.type === "receipt" && m.qty > 0 && m.occurredAt >= fromIso && m.occurredAt <= toIso);
  return { units: round(sum(rows.map((m) => m.qty)), 3), value: round(sum(rows.map((m) => m.qty * (m.unitCost ?? 0)))) };
}
