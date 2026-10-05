import type { Item, StockAlertRule, WorkspaceSettings } from "@/lib/types";
import { crossRefText } from "@/lib/scan";
import { isLowStock } from "@/lib/inventory";
import { matches } from "@/lib/utils";

/** The built-in chips, plus one per item type defined in Settings → Catalog ("type:<id>"). */
export type InventoryView = "all" | "active" | "low" | "assemblies" | "kits" | "inactive" | `type:${string}`;

export const INVENTORY_VIEWS: Array<{ value: InventoryView; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "low", label: "Low stock" },
  { value: "assemblies", label: "Assemblies" },
  { value: "kits", label: "Kits" },
  { value: "inactive", label: "Inactive" },
];

/** The chips for this workspace: the built-in ones with the workspace's own item types slotted in before Inactive. */
export function inventoryViews(settings: Pick<WorkspaceSettings, "catalog">): Array<{ value: InventoryView; label: string }> {
  const custom = (settings.catalog?.itemTypes ?? []).filter((t) => t.label.trim()).map((t) => ({ value: `type:${t.id}` as InventoryView, label: t.label.trim() }));
  const inactive = INVENTORY_VIEWS.find((v) => v.value === "inactive")!;
  return [...INVENTORY_VIEWS.filter((v) => v.value !== "inactive"), ...custom, inactive];
}

export function isInventoryView(value: string | null | undefined): value is InventoryView {
  return INVENTORY_VIEWS.some((v) => v.value === value) || (typeof value === "string" && value.startsWith("type:") && value.length > 5);
}

export function matchesView(item: Item, view: InventoryView, rule?: StockAlertRule): boolean {
  switch (view) {
    case "active":
      return item.status === "active";
    case "low":
      return isLowStock(item, rule);
    case "assemblies":
      return item.type === "assembly";
    case "kits":
      return item.type === "kit";
    case "inactive":
      return item.status === "inactive" || item.status === "superseded";
    default:
      return view.startsWith("type:") ? item.type === view.slice("type:".length) : true;
  }
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
export function describeFilters(f: InventoryFilters, supplierName?: string, views: Array<{ value: InventoryView; label: string }> = INVENTORY_VIEWS): string {
  const parts: string[] = [];
  if (f.view !== "all") parts.push(`view "${views.find((v) => v.value === f.view)?.label ?? f.view}"`);
  if (f.category) parts.push(`category "${f.category}"`);
  if (f.supplierId) parts.push(`supplier "${supplierName ?? f.supplierId}"`);
  if (f.q.trim()) parts.push(`search "${f.q.trim()}"`);
  return parts.length ? parts.join(", ") : "no filters";
}
