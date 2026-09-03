import { TARGET_FIELDS, type ColumnMapping, type MappingTarget, type SourceKind, type TargetField } from "./types";

/** Lower-case, drop parentheticals ("Cost (USD)" -> "cost") and collapse punctuation to single spaces. */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Platform exports. Keys are normalised headers.
// ---------------------------------------------------------------------------

const SHOPIFY: Record<string, MappingTarget> = {
  handle: "ignore",
  title: "name",
  "body html": "description",
  body: "description",
  vendor: "supplierName",
  "product category": "category",
  type: "category",
  tags: "tags",
  published: "ignore",
  "variant sku": "sku",
  "variant inventory qty": "qty",
  "variant inventory tracker": "ignore",
  "variant inventory policy": "ignore",
  "variant price": "price",
  "variant compare at price": "ignore",
  "cost per item": "unitCost",
  "variant barcode": "barcode",
  "variant grams": "ignore",
  "variant weight unit": "ignore",
  status: "ignore",
};

const WOOCOMMERCE: Record<string, MappingTarget> = {
  id: "ignore",
  type: "ignore",
  sku: "sku",
  "gtin upc ean or isbn": "barcode",
  name: "name",
  published: "ignore",
  "is featured": "ignore",
  "visibility in catalog": "ignore",
  "short description": "description",
  description: "description",
  "in stock": "ignore",
  stock: "qty",
  "low stock amount": "minQty",
  "regular price": "price",
  "sale price": "ignore",
  categories: "category",
  tags: "tags",
  position: "ignore",
  brands: "ignore",
};

// ---------------------------------------------------------------------------
// Generic synonyms. Normalised phrases; matched exactly first, then as a
// whole-word phrase inside the header ("Qty on hand" contains "on hand").
// ---------------------------------------------------------------------------

const SYNONYMS: Array<[TargetField, string[]]> = [
  ["sku", ["sku", "part number", "part no", "part", "part id", "item number", "item no", "item code", "product code", "product sku", "item sku", "variant sku", "code", "mpn"]],
  ["name", ["name", "item", "item name", "product", "product name", "title", "product title", "part name", "part description"]],
  ["description", ["description", "desc", "long description", "short description", "details", "notes", "body html", "body"]],
  ["category", ["category", "categories", "product category", "product type", "group", "product group", "class", "family", "collection"]],
  ["type", ["type", "item type", "kind", "part type"]],
  ["unit", ["unit", "units", "uom", "unit of measure", "unit of measurement", "measure"]],
  [
    "qty",
    [
      "qty",
      "quantity",
      "on hand",
      "onhand",
      "qty on hand",
      "quantity on hand",
      "qoh",
      "stock",
      "in stock",
      "stock qty",
      "stock quantity",
      "stock level",
      "inventory",
      "inventory qty",
      "inventory quantity",
      "variant inventory qty",
      "available",
      "available qty",
      "count",
      "opening qty",
      "opening quantity",
      "opening stock",
      "balance",
    ],
  ],
  ["unitCost", ["unit cost", "unitcost", "cost", "cost per item", "cost price", "purchase price", "buy price", "buying price", "average cost", "avg cost", "standard cost", "std cost", "landed cost", "cost each"]],
  ["price", ["price", "sell price", "selling price", "sale price", "sales price", "list price", "retail price", "unit price", "regular price", "variant price", "msrp", "rrp", "price each"]],
  ["minQty", ["min", "min qty", "minqty", "minimum", "minimum qty", "min quantity", "minimum quantity", "min stock", "reorder point", "reorder level", "reorder at", "low stock", "low stock amount", "safety stock", "par", "par level", "min level"]],
  ["maxQty", ["max", "max qty", "maxqty", "maximum", "maximum qty", "max quantity", "maximum quantity", "max stock", "reorder to", "order up to", "max level", "target qty", "target quantity"]],
  ["leadTimeDays", ["lead time", "leadtime", "lead time days", "leadtimedays", "lead days", "lead time in days", "leadtime days", "days lead time"]],
  ["location", ["location", "bin", "bin location", "shelf", "shelf location", "warehouse location", "storage location", "stock location", "rack", "aisle", "position"]],
  ["barcode", ["barcode", "bar code", "upc", "ean", "gtin", "isbn", "upc code", "ean code", "variant barcode", "gtin upc ean or isbn"]],
  ["supplierName", ["supplier", "supplier name", "suppliername", "vendor", "vendor name", "preferred supplier", "preferred vendor", "manufacturer", "source", "distributor"]],
  ["tags", ["tags", "tag", "labels", "label", "keywords"]],
];

const EXACT = new Map<string, TargetField>();
for (const [field, words] of SYNONYMS) for (const w of words) if (!EXACT.has(w)) EXACT.set(w, field);

/** Synonyms sorted longest-first for the phrase pass so "unit cost" beats "cost". */
const PHRASES: Array<{ field: TargetField; words: string[] }> = SYNONYMS.flatMap(([field, words]) => words.map((w) => ({ field, words: w.split(" ") })))
  .filter((p) => p.words.join(" ").length >= 3)
  .sort((a, b) => b.words.length - a.words.length || b.words.join(" ").length - a.words.join(" ").length);

const TARGET_BY_COMPACT = new Map<string, TargetField>(TARGET_FIELDS.map((f) => [f.toLowerCase(), f]));

export function detectSourceKind(headers: string[]): SourceKind {
  const n = new Set(headers.map(normalizeHeader));
  if (n.has("variant sku") || (n.has("handle") && n.has("title")) || n.has("variant inventory qty")) return "shopify";
  if (n.has("regular price") || n.has("short description") || (n.has("categories") && n.has("sku"))) return "woocommerce";
  return "generic";
}

function containsPhrase(words: string[], phrase: string[]): boolean {
  if (phrase.length > words.length) return false;
  for (let i = 0; i + phrase.length <= words.length; i++) {
    let ok = true;
    for (let j = 0; j < phrase.length; j++) {
      if (words[i + j] !== phrase[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

export interface GuessResult {
  mapping: ColumnMapping;
  kind: SourceKind;
}

/**
 * Guess a column mapping. Platform tables win when the file looks like a
 * Shopify or WooCommerce export; otherwise exact field names and synonyms,
 * then whole-phrase containment. Each target is assigned at most once.
 */
export function guessMapping(headers: string[]): GuessResult {
  const kind = detectSourceKind(headers);
  const table = kind === "shopify" ? SHOPIFY : kind === "woocommerce" ? WOOCOMMERCE : {};
  const mapping: ColumnMapping = {};
  const used = new Set<TargetField>();
  const pending: Array<{ header: string; words: string[] }> = [];

  const assign = (header: string, target: MappingTarget) => {
    if (target !== "ignore" && used.has(target)) target = "ignore";
    if (target !== "ignore") used.add(target);
    mapping[header] = target;
  };

  for (const header of headers) {
    const norm = normalizeHeader(header);
    const compact = norm.replace(/\s+/g, "");
    let target: MappingTarget | undefined = table[norm];
    if (target === undefined) target = TARGET_BY_COMPACT.get(compact);
    if (target === undefined) target = EXACT.get(norm);
    if (target !== undefined) assign(header, target);
    else pending.push({ header, words: norm.split(" ").filter(Boolean) });
  }

  for (const { header, words } of pending) {
    const hit = PHRASES.find((p) => !used.has(p.field) && containsPhrase(words, p.words));
    assign(header, hit ? hit.field : "ignore");
  }

  return { mapping, kind };
}

/** Change one column's target, un-assigning any other column that used it. */
export function setMappingTarget(mapping: ColumnMapping, header: string, target: MappingTarget): ColumnMapping {
  const next: ColumnMapping = { ...mapping };
  if (target !== "ignore") {
    for (const h of Object.keys(next)) if (h !== header && next[h] === target) next[h] = "ignore";
  }
  next[header] = target;
  return next;
}

export function isMappingTarget(value: unknown): value is MappingTarget {
  return typeof value === "string" && (value === "ignore" || (TARGET_FIELDS as readonly string[]).includes(value));
}

/** Target field -> source header for every mapped field. */
export function invertMapping(mapping: ColumnMapping): Partial<Record<TargetField, string>> {
  const out: Partial<Record<TargetField, string>> = {};
  for (const [header, target] of Object.entries(mapping)) if (target !== "ignore" && out[target] === undefined) out[target] = header;
  return out;
}
