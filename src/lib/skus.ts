import type { Item, StoreProductWithoutSku } from "@/lib/types";

/** Short uppercase code for a word: letters and digits only, at most `len` characters. */
function code(word: string, len: number): string {
  return word.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, len);
}

/** Separator most of the workspace's SKUs use ("-" by default), so suggestions look like the rest of the catalog. */
export function skuSeparator(items: Pick<Item, "sku">[]): string {
  let dash = 0;
  let underscore = 0;
  let none = 0;
  for (const i of items) {
    if (i.sku.includes("-")) dash++;
    else if (i.sku.includes("_")) underscore++;
    else none++;
  }
  if (underscore > dash && underscore > none) return "_";
  if (none > dash && none > underscore && items.length >= 5) return "";
  return "-";
}

/**
 * A readable SKU from a store product's title and variant, e.g. "Halcyon Overdrive – Blue" → HAL-OVE-BLU.
 * Unique against the catalog and the other suggestions in the same batch; numbered when it collides.
 */
export function suggestSku(product: Pick<StoreProductWithoutSku, "title" | "variantTitle">, taken: Set<string>, separator = "-"): string {
  const words = product.title.split(/[\s/,&+]+/).filter((w) => w && !/^(the|a|an|and|of|for|with)$/i.test(w));
  const base = words.slice(0, 3).map((w) => code(w, 3)).filter(Boolean);
  const variant = (product.variantTitle ?? "").split(/[\s/,&+]+/).filter(Boolean).slice(0, 2).map((w) => code(w, 3)).filter(Boolean);
  const stem = [...base, ...variant].join(separator) || "ITEM";
  let candidate = stem;
  let n = 2;
  while (taken.has(candidate.toUpperCase())) candidate = `${stem}${separator}${n++}`;
  taken.add(candidate.toUpperCase());
  return candidate;
}

/** One suggestion per SKU-less product, in order, none colliding with the catalog or each other. */
export function suggestSkus(products: StoreProductWithoutSku[], items: Pick<Item, "sku">[]): Map<string, string> {
  const taken = new Set(items.map((i) => i.sku.toUpperCase()));
  const sep = skuSeparator(items);
  const out = new Map<string, string>();
  for (const p of products) out.set(p.key, suggestSku(p, taken, sep));
  return out;
}

/** Display name for a SKU-less store product. */
export function storeProductLabel(p: Pick<StoreProductWithoutSku, "title" | "variantTitle">): string {
  return p.variantTitle ? `${p.title} – ${p.variantTitle}` : p.title;
}
