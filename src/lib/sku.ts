/**
 * A SKU made from a product name ("Wagyu Ribeye Steak" → WAGYU-RIBEYE-STEAK),
 * unique among `taken` (upper-case SKUs), which it extends with the new one.
 */
export function skuFromName(name: string, taken: Set<string>): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "ITEM";
  let sku = base;
  for (let n = 2; taken.has(sku); n++) sku = `${base}-${n}`;
  taken.add(sku);
  return sku;
}
