import type { Item, StockAlertRule } from "@/lib/types";
import { crossRefText } from "@/lib/scan";
import { isLowStock } from "@/lib/inventory";
import { isOverstock } from "@/lib/overstock";
import { matches } from "@/lib/utils";

export type InventoryView = "all" | "active" | "low" | "overstock" | "assemblies" | "inactive";

export const INVENTORY_VIEWS: Array<{ value: InventoryView; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "low", label: "Low stock" },
  { value: "overstock", label: "Overstock" },
  { value: "assemblies", label: "Assemblies" },
  { value: "inactive", label: "Inactive" },
];

/** The views offered, without the ones that belong to a feature that is switched off (src/lib/features.ts). */
export function inventoryViews(opts: { overstock: boolean }): Array<{ value: InventoryView; label: string }> {
  return INVENTORY_VIEWS.filter((v) => v.value !== "overstock" || opts.overstock);
}

export function isInventoryView(value: string | null | undefined): value is InventoryView {
  return INVENTORY_VIEWS.some((v) => v.value === value);
}

export function matchesView(item: Item, view: InventoryView, rule?: StockAlertRule): boolean {
  switch (view) {
    case "active":
      return item.status === "active";
    case "low":
      return isLowStock(item, rule);
    case "overstock":
      return isOverstock(item);
    case "assemblies":
      return item.type === "assembly";
    case "inactive":
      return item.status === "inactive" || item.status === "superseded";
    default:
      return true;
  }
}

/**
 * Whether an item lives at a location (feature `inventoryPageFixes`): it has stock or a bin there,
 * purchase orders receive it there or sales orders ship it from there, or, with no routing of its
 * own and no stock anywhere else, it belongs to the default location. Items at zero stock still show.
 */
export function itemIsAtLocation(item: Item, locationId: string, homeId: string): boolean {
  const entry = item.stock?.[locationId];
  if (entry && (entry.qty !== 0 || entry.bin)) return true;
  if (!item.stock && locationId === homeId && item.onHand !== 0) return true;
  if (item.receiveLocationId === locationId || item.fulfillLocationId === locationId) return true;
  if (locationId !== homeId || item.receiveLocationId || item.fulfillLocationId) return false;
  // Unrouted items with no stock elsewhere belong to the default location.
  return !Object.entries(item.stock ?? {}).some(([id, s]) => id !== homeId && s.qty !== 0);
}

export function matchesSearch(item: Item, q: string): boolean {
  return matches(q, item.sku, item.name, item.category, item.tags.join(" "), item.barcode, item.location, crossRefText(item));
}

export interface InventoryFilters {
  q: string;
  view: InventoryView;
  category: string;
  supplierId: string;
}

/** Human-readable description of the active filters, for Strato prompt. */
export function describeFilters(f: InventoryFilters, supplierName?: string): string {
  const parts: string[] = [];
  if (f.view !== "all") parts.push(`view "${INVENTORY_VIEWS.find((v) => v.value === f.view)?.label ?? f.view}"`);
  if (f.category) parts.push(`category "${f.category}"`);
  if (f.supplierId) parts.push(`supplier "${supplierName ?? f.supplierId}"`);
  if (f.q.trim()) parts.push(`search "${f.q.trim()}"`);
  return parts.length ? parts.join(", ") : "no filters";
}
