/**
 * Factor 32: barcode lookup shared by the camera scanner, the keyboard wedge
 * and the search boxes. A scanned code can be a barcode (UPC/EAN/GTIN), an
 * internal SKU, a cross-reference number or a channel id.
 */
import type { CrossRef, Item } from "@/lib/types";

export type CodeMatchKind = "barcode" | "sku" | "crossRef" | "channel";

export interface CodeMatch {
  item: Item;
  matchedBy: CodeMatchKind;
  ref?: CrossRef;
}

/** Control characters scanners emit as prefix/suffix (STX, ETX, CR, LF, TAB and friends). */
const CONTROL_CHARS = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}]`, "g");

/** Strip scanner control characters and surrounding space. */
export function normalizeCode(raw: string): string {
  return raw.replace(CONTROL_CHARS, "").trim();
}

function eq(a: string | undefined, b: string): boolean {
  return !!a && a.trim().toLowerCase() === b.toLowerCase();
}

/** GTIN-12 (UPC-A) is often scanned as EAN-13 with a leading zero; compare both ways. */
function gtinEq(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const x = a.replace(/\s+/g, "");
  const y = b.replace(/\s+/g, "");
  if (x === y) return true;
  if (!/^\d+$/.test(x) || !/^\d+$/.test(y)) return false;
  return x.replace(/^0+/, "") === y.replace(/^0+/, "");
}

export function matchCode(item: Item, raw: string): CodeMatch | null {
  const code = normalizeCode(raw);
  if (!code) return null;
  if (gtinEq(item.barcode, code)) return { item, matchedBy: "barcode" };
  if (eq(item.sku, code)) return { item, matchedBy: "sku" };
  const ref = item.crossRefs?.find((r) => eq(r.number, code));
  if (ref) return { item, matchedBy: "crossRef", ref };
  const ch = item.channels;
  if (ch?.shopify && (eq(ch.shopify.variantId, code) || eq(ch.shopify.productId, code))) return { item, matchedBy: "channel" };
  if (ch?.woocommerce && (eq(ch.woocommerce.productId, code) || eq(ch.woocommerce.variationId, code))) return { item, matchedBy: "channel" };
  return null;
}

/** The item a scanned code belongs to. Barcodes win over SKUs, which win over cross-references. */
export function findItemByCode(items: Item[], raw: string): CodeMatch | null {
  const code = normalizeCode(raw);
  if (!code) return null;
  let best: CodeMatch | null = null;
  const rank: Record<CodeMatchKind, number> = { barcode: 0, sku: 1, crossRef: 2, channel: 3 };
  for (const item of items) {
    const m = matchCode(item, code);
    if (m && (!best || rank[m.matchedBy] < rank[best.matchedBy])) best = m;
    if (best?.matchedBy === "barcode") break;
  }
  return best;
}

/** Text that free-text search should match for an item's cross-references. */
export function crossRefText(item: Item): string {
  return (item.crossRefs ?? []).map((r) => `${r.number} ${r.source ?? ""}`).join(" ");
}
