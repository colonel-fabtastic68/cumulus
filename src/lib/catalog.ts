import type { CatalogSettings, CustomFieldDef, ItemType, WorkspaceSettings } from "@/lib/types";

/** Workspace vocabulary helpers (Settings → Catalogue). */

export const BUILT_IN_ITEM_TYPES: Array<{ id: ItemType; label: string }> = [
  { id: "part", label: "Part" },
  { id: "assembly", label: "Assembly (has a BOM)" },
];

export function itemTypeOptions(settings: Pick<WorkspaceSettings, "catalog">): Array<{ value: string; label: string }> {
  const custom = (settings.catalog?.itemTypes ?? []).map((t) => ({ value: t.id, label: t.label }));
  return [...BUILT_IN_ITEM_TYPES.map((t) => ({ value: t.id, label: t.label })), ...custom];
}

export function itemTypeLabel(settings: Pick<WorkspaceSettings, "catalog">, type: string): string {
  if (type === "part") return "Part";
  if (type === "assembly") return "Assembly";
  return settings.catalog?.itemTypes?.find((t) => t.id === type)?.label ?? type;
}

export function customFieldsFor(settings: Pick<WorkspaceSettings, "catalog">, kind: "items" | "customers" | "suppliers"): CustomFieldDef[] {
  return settings.catalog?.customFields?.[kind] ?? [];
}

export function priceGroups(settings: Pick<WorkspaceSettings, "catalog">): Array<{ id: string; name: string }> {
  return settings.catalog?.priceGroups ?? [];
}

/** A stable key from a label: "Wheel diameter" → "wheel_diameter". */
export function keyFromLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "field";
}

export function emptyCatalog(): Required<CatalogSettings> {
  return { itemTypes: [], priceGroups: [], customFields: { items: [], customers: [], suppliers: [] } };
}
