import type { WorkspaceSettings } from "@/lib/types";

/**
 * What a workspace calls the item code. Plenty of shops have never used the
 * word SKU: they have part numbers. The stored field stays `sku`; only the
 * word on screen, in prints and in exports changes (feature "partNumbers").
 */

export interface Terms {
  /** "SKU", "Part number". Sentence case, for labels and column headers. */
  itemCode: string;
  /** "SKU", "PN". For narrow columns and compact text. */
  itemCodeShort: string;
  /** "SKUs", "Part numbers". */
  itemCodes: string;
}

export const DEFAULT_TERMS: Terms = { itemCode: "SKU", itemCodeShort: "SKU", itemCodes: "SKUs" };

/** Ready-made choices offered in Settings → Catalog. */
export const ITEM_CODE_PRESETS: Array<{ itemCode: string; itemCodeShort: string }> = [
  { itemCode: "SKU", itemCodeShort: "SKU" },
  { itemCode: "Part number", itemCodeShort: "PN" },
  { itemCode: "Item number", itemCodeShort: "Item #" },
  { itemCode: "Product code", itemCodeShort: "Code" },
];

function shortFor(itemCode: string): string {
  const preset = ITEM_CODE_PRESETS.find((p) => p.itemCode.toLowerCase() === itemCode.toLowerCase());
  if (preset) return preset.itemCodeShort;
  const words = itemCode.split(/\s+/).filter(Boolean);
  return words.length > 1 ? words.map((w) => w[0]!.toUpperCase()).join("") : itemCode;
}

function pluralOf(word: string): string {
  if (/^[A-Z0-9#]+$/.test(word)) return `${word}s`;
  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  return /(s|x|ch|sh)$/i.test(word) ? `${word}es` : `${word}s`;
}

/** The words a workspace uses, or the cumulusOS defaults when the feature is off or nothing is set. */
export function termsFor(settings: Pick<WorkspaceSettings, "terminology"> | null | undefined, enabled = true): Terms {
  const itemCode = enabled ? settings?.terminology?.itemCode?.trim() : undefined;
  if (!itemCode || itemCode.toLowerCase() === "sku") return DEFAULT_TERMS;
  const itemCodeShort = settings?.terminology?.itemCodeShort?.trim() || shortFor(itemCode);
  return { itemCode, itemCodeShort, itemCodes: pluralOf(itemCode) };
}
