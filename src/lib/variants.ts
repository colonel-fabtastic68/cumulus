import type { Item, VariantAxis } from "@/lib/types";
import type { Store } from "@/lib/store/types";
import { createItems, InventoryError, updateItem, type Actor } from "@/lib/inventory";
import { skuSeparator } from "@/lib/skus";
import { round, sum } from "@/lib/utils";

/**
 * Item variants. A T-shirt in four sizes and three colors is one product to the
 * people selling it, not twelve hand-made SKUs. The parent item carries the
 * shared details (name, price, supplier, category) and lists its options; every
 * combination is a variant: a real item underneath, created and numbered
 * automatically, so stock, orders, lots and store sync keep working per
 * size/color with nothing new in the ledger.
 *
 * Lists show the family as one row (the parent with the summed stock); the
 * variants appear when the row is opened or when a specific one is searched.
 */

export function isVariantParent(item: Pick<Item, "variantAxes">): boolean {
  return (item.variantAxes?.length ?? 0) > 0;
}

export function isVariant(item: Pick<Item, "variantOf">): boolean {
  return !!item.variantOf;
}

export function variantsOf(items: Item[], parentId: string): Item[] {
  return items.filter((i) => i.variantOf === parentId);
}

/** Tidy option lists: trimmed names and values, duplicates and blanks dropped. */
export function cleanAxes(axes: VariantAxis[]): VariantAxis[] {
  const seen = new Set<string>();
  const out: VariantAxis[] = [];
  for (const a of axes) {
    const name = a.name.trim();
    const values = Array.from(new Set(a.values.map((v) => v.trim()).filter(Boolean)));
    if (!name || values.length === 0 || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name, values });
  }
  return out;
}

/** Every combination of the options, in the order the values are listed. */
export function variantCombos(axes: VariantAxis[]): Array<Record<string, string>> {
  return cleanAxes(axes).reduce<Array<Record<string, string>>>((acc, axis) => acc.flatMap((combo) => axis.values.map((v) => ({ ...combo, [axis.name]: v }))), [{}]).filter((c) => Object.keys(c).length > 0);
}

export function comboKey(options: Record<string, string> | undefined, axes: VariantAxis[]): string {
  return axes.map((a) => (options?.[a.name] ?? "").trim().toLowerCase()).join("|");
}

/** "Black / M" for a variant. */
export function variantLabel(options: Record<string, string> | undefined, axes?: VariantAxis[]): string {
  if (!options) return "";
  const names = axes?.length ? axes.map((a) => a.name) : Object.keys(options);
  return names.map((n) => options[n]).filter(Boolean).join(" / ");
}

function codeFor(value: string): string {
  const cleaned = value.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  // Sizes and short codes stay whole; longer words are cut to their first three characters.
  return cleaned.length <= 4 ? cleaned : cleaned.slice(0, 3);
}

/** The automatic code for a variant: the parent's code plus a short code per option (TEE-BLA-M). */
export function variantSku(parentSku: string, options: Record<string, string>, axes: VariantAxis[], separator = "-"): string {
  return [parentSku, ...axes.map((a) => codeFor(options[a.name] ?? ""))].filter(Boolean).join(separator);
}

export interface VariantPlanRow {
  options: Record<string, string>;
  sku: string;
  name: string;
  /** Already an item under this parent. */
  existing?: Item;
}

/** What the family would look like with these options: each combination, its code, and whether it already exists. */
export function planVariants(parent: Item, axes: VariantAxis[], items: Item[]): VariantPlanRow[] {
  const clean = cleanAxes(axes);
  // Codes are built from parts, so they always get a separator even when the catalog's own codes have none.
  const separator = skuSeparator(items) || "-";
  const children = variantsOf(items, parent.id);
  const taken = new Set(items.map((i) => i.sku.toUpperCase()));
  return variantCombos(clean).map((options) => {
    const existing = children.find((c) => comboKey(c.variantOptions, clean) === comboKey(options, clean));
    let sku = existing?.sku ?? variantSku(parent.sku, options, clean, separator);
    // Two values that shorten to the same code (Blue, Blush) get a number.
    for (let n = 2; !existing && taken.has(sku.toUpperCase()); n++) sku = `${variantSku(parent.sku, options, clean, separator)}${n}`;
    if (!existing) taken.add(sku.toUpperCase());
    return { options, sku, name: `${parent.name} · ${variantLabel(options, clean)}`, existing };
  });
}

/** Details a variant takes from its parent when it is created. Stock, cost history and channel links are its own. */
function inherited(parent: Item): Partial<Item> {
  const { description, type, category, tags, unit, unitCost, price, salePrice, priceBreaks, groupPrices, mapPrice, supplierId, supplierSku, suppliers, leadTimeDays, brand, weight, weightUnit, dimensions, imageUrl, uoms, purchaseUnit, salesUnit, receiveLocationId, fulfillLocationId, attributes } = parent;
  return { description, type, category, tags: [...tags], unit, unitCost, price, salePrice, priceBreaks, groupPrices, mapPrice, supplierId, supplierSku, suppliers, leadTimeDays, brand, weight, weightUnit, dimensions, imageUrl, uoms, purchaseUnit, salesUnit, receiveLocationId, fulfillLocationId, attributes };
}

/**
 * Sets a parent's options and creates the variants that do not exist yet.
 * Variants that no longer match any combination are left alone (they may hold
 * stock or history); the caller decides whether to deactivate them.
 */
export async function saveVariants(store: Store, actor: Actor, parentId: string, axes: VariantAxis[]): Promise<{ created: Item[]; orphaned: Item[] }> {
  const items = await store.list("items");
  const parent = items.find((i) => i.id === parentId);
  if (!parent) throw new InventoryError("Item not found");
  if (parent.variantOf) throw new InventoryError(`${parent.sku} is itself a variant; add the options to its parent`);
  const clean = cleanAxes(axes);
  if (clean.length === 0) throw new InventoryError("Add at least one option with a value");
  const plan = planVariants(parent, clean, items);
  if (plan.length > 200) throw new InventoryError(`These options make ${plan.length} variants; the limit is 200`);
  if (parent.onHand !== 0 && variantsOf(items, parent.id).length === 0) {
    throw new InventoryError(`${parent.sku} has ${parent.onHand} on hand. Stock lives on the variants, so move or adjust it to zero first.`);
  }
  await updateItem(store, actor, parent.id, { variantAxes: clean }, "Variant options");
  const missing = plan.filter((p) => !p.existing);
  const created = missing.length ? await createItems(store, actor, missing.map((p) => ({ ...inherited(parent), sku: p.sku, name: p.name, variantOf: parent.id, variantOptions: p.options }))) : [];
  const wanted = new Set(plan.map((p) => comboKey(p.options, clean)));
  const orphaned = variantsOf(items, parent.id).filter((c) => !wanted.has(comboKey(c.variantOptions, clean)));
  return { created, orphaned };
}

export interface ItemFamily {
  parent: Item;
  variants: Item[];
  onHand: number;
  value: number;
}

/** A parent with its variants and their combined stock. */
export function itemFamily(parent: Item, items: Item[]): ItemFamily {
  const variants = variantsOf(items, parent.id);
  return { parent, variants, onHand: round(sum(variants.map((v) => v.onHand)), 3), value: round(sum(variants.map((v) => v.onHand * v.unitCost))) };
}

/**
 * Rows for a list that shows each family once: variants are folded into their
 * parent, which carries the family's stock. Items outside any family pass through.
 */
export function collapseFamilies(items: Item[]): Item[] {
  const parents = new Map(items.filter(isVariantParent).map((p) => [p.id, p]));
  if (parents.size === 0) return items;
  const totals = new Map<string, number>();
  for (const i of items) if (i.variantOf && parents.has(i.variantOf)) totals.set(i.variantOf, round((totals.get(i.variantOf) ?? 0) + i.onHand, 3));
  return items.filter((i) => !(i.variantOf && parents.has(i.variantOf))).map((i) => (parents.has(i.id) ? { ...i, onHand: totals.get(i.id) ?? 0 } : i));
}
