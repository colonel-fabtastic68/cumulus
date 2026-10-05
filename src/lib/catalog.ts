import type { CatalogSettings, CustomFieldDef, Item, ItemType, PriceGroup, WorkspaceSettings } from "@/lib/types";

/** Workspace vocabulary helpers (Settings → Catalog). */

export const BUILT_IN_ITEM_TYPES: Array<{ id: ItemType; label: string }> = [
  { id: "part", label: "Part" },
  { id: "assembly", label: "Assembly (built from a BOM)" },
  { id: "kit", label: "Kit (components picked at shipping)" },
];

export function itemTypeOptions(settings: Pick<WorkspaceSettings, "catalog">): Array<{ value: string; label: string }> {
  const custom = (settings.catalog?.itemTypes ?? []).map((t) => ({ value: t.id, label: t.label }));
  return [...BUILT_IN_ITEM_TYPES.map((t) => ({ value: t.id, label: t.label })), ...custom];
}

export function itemTypeLabel(settings: Pick<WorkspaceSettings, "catalog">, type: string): string {
  if (type === "part") return "Part";
  if (type === "assembly") return "Assembly";
  if (type === "kit") return "Kit";
  return settings.catalog?.itemTypes?.find((t) => t.id === type)?.label ?? type;
}

/** The categories kept in Settings → Categories. */
export function listedCategories(settings: Pick<WorkspaceSettings, "catalog">): string[] {
  return settings.catalog?.categories ?? [];
}

/** Every category to offer: the ones kept in Settings and the ones items already carry, sorted, without duplicates. */
export function categoryOptions(settings: Pick<WorkspaceSettings, "catalog">, items: Array<Pick<Item, "category">>): string[] {
  const seen = new Map<string, string>();
  for (const c of [...listedCategories(settings), ...items.map((i) => i.category ?? "")]) {
    const name = c.trim();
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

export function customFieldsFor(settings: Pick<WorkspaceSettings, "catalog">, kind: "items" | "customers" | "suppliers"): CustomFieldDef[] {
  return settings.catalog?.customFields?.[kind] ?? [];
}

export function priceGroups(settings: Pick<WorkspaceSettings, "catalog">): PriceGroup[] {
  return settings.catalog?.priceGroups ?? [];
}

/** "Stocking dealer · 15% off" for menus and columns. */
export function priceGroupLabel(g: PriceGroup, currency = "USD"): string {
  if (!g.value) return g.name;
  return g.kind === "amount" ? `${g.name} · ${new Intl.NumberFormat(undefined, { style: "currency", currency }).format(g.value)} off` : `${g.name} · ${g.value}% off`;
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
  return { itemTypes: [], categories: [], priceGroups: [], customFields: { items: [], customers: [], suppliers: [] } };
}
