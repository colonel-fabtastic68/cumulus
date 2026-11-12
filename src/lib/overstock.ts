import type { Item } from "@/lib/types";
import { round, sum } from "@/lib/utils";

/**
 * Overstock: an item sitting above its max. The mirror image of low stock, and
 * the same kind of money problem: cash on the shelf that is not moving.
 */

/** Units above the item's max; 0 when it has no max or is at or under it. */
export function overstockQty(item: Pick<Item, "onHand" | "maxQty">): number {
  if (item.maxQty === undefined || item.maxQty <= 0) return 0;
  return Math.max(0, round(item.onHand - item.maxQty, 3));
}

export function isOverstock(item: Pick<Item, "onHand" | "maxQty" | "status">): boolean {
  return item.status === "active" && overstockQty(item) > 0;
}

/** What the excess is worth at the item's current unit cost. */
export function overstockValue(item: Pick<Item, "onHand" | "maxQty" | "unitCost">): number {
  return round(overstockQty(item) * item.unitCost);
}

export interface OverstockRow {
  item: Item;
  excess: number;
  /** Excess as a percentage of max. */
  overPct: number;
  value: number;
}

/** Overstocked items, the most money tied up first. */
export function overstockReport(items: Item[]): OverstockRow[] {
  return items
    .filter(isOverstock)
    .map((item) => {
      const excess = overstockQty(item);
      return { item, excess, overPct: round((excess / item.maxQty!) * 100, 1), value: overstockValue(item) };
    })
    .sort((a, b) => b.value - a.value || b.excess - a.excess);
}

export function overstockTotal(items: Item[]): number {
  return round(sum(items.filter(isOverstock).map(overstockValue)));
}
