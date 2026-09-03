import type { Item } from "@/lib/types";
import { isLowStock } from "@/lib/inventory";
import { matches } from "@/lib/utils";

export type InventoryView = "all" | "active" | "low" | "assemblies" | "inactive";

export const INVENTORY_VIEWS: Array<{ value: InventoryView; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "low", label: "Low stock" },
  { value: "assemblies", label: "Assemblies" },
  { value: "inactive", label: "Inactive" },
];

export function isInventoryView(value: string | null | undefined): value is InventoryView {
  return INVENTORY_VIEWS.some((v) => v.value === value);
}

export function matchesView(item: Item, view: InventoryView): boolean {
  switch (view) {
    case "active":
      return item.status === "active";
    case "low":
      return isLowStock(item);
    case "assemblies":
      return item.type === "assembly";
    case "inactive":
      return item.status === "inactive" || item.status === "superseded";
    default:
      return true;
  }
}

export function matchesSearch(item: Item, q: string): boolean {
  return matches(q, item.sku, item.name, item.category, item.tags.join(" "), item.barcode, item.location);
}

export interface InventoryFilters {
  q: string;
  view: InventoryView;
  category: string;
  supplierId: string;
}

/** Human-readable description of the active filters, for the agent prompt. */
export function describeFilters(f: InventoryFilters, supplierName?: string): string {
  const parts: string[] = [];
  if (f.view !== "all") parts.push(`view "${INVENTORY_VIEWS.find((v) => v.value === f.view)?.label ?? f.view}"`);
  if (f.category) parts.push(`category "${f.category}"`);
  if (f.supplierId) parts.push(`supplier "${supplierName ?? f.supplierId}"`);
  if (f.q.trim()) parts.push(`search "${f.q.trim()}"`);
  return parts.length ? parts.join(", ") : "no filters";
}
