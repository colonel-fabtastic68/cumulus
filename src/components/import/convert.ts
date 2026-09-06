import type { ImportRow } from "@/lib/inventory";
import type { Item } from "@/lib/types";
import { uniq } from "@/lib/utils";
import { customColumns, invertMapping } from "./mapping";
import { FIELD_LABELS, type ColumnMapping, type ReviewRow, type TargetField } from "./types";

export interface NumberParse {
  value: number | undefined;
  error?: string;
}

/** Lenient number parsing: "$1,200.50", "USD 12", "(5)", "14 days", "12 ea" all work. Empty -> undefined. */
export function parseLenientNumber(raw: string | undefined): NumberParse {
  const s = (raw ?? "").trim();
  if (!s) return { value: undefined };
  let cleaned = s
    .replace(/[$€£¥₹,\s]/g, "")
    .replace(/^[A-Za-z]{3}(?=[\d.(+-])/, "")
    .replace(/[A-Za-z%]+$/, "");
  let negative = false;
  if (/^\(.*\)$/.test(cleaned)) {
    negative = true;
    cleaned = cleaned.slice(1, -1);
  }
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(cleaned)) return { value: undefined, error: `"${s}" is not a number` };
  const n = Number(cleaned);
  return { value: negative ? -n : n };
}

export function normalizeItemType(raw: string | undefined): Item["type"] | undefined {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return undefined;
  if (/assembl|assy|kit|bundle|finished|\bfg\b|build|product/.test(s)) return "assembly";
  return "part";
}

export function splitTags(raw: string | undefined): string[] {
  return uniq(
    (raw ?? "")
      .split(/[,|]/)
      .map((t) => t.trim())
      .filter(Boolean),
  );
}

const TEXT_FIELDS: Array<"name" | "description" | "category" | "unit" | "location" | "barcode" | "supplierName" | "brand" | "imageUrl" | "externalId"> = [
  "name",
  "description",
  "category",
  "unit",
  "location",
  "barcode",
  "supplierName",
  "brand",
  "imageUrl",
  "externalId",
];

const NUMBER_FIELDS: Array<"qty" | "unitCost" | "price" | "salePrice" | "minQty" | "maxQty" | "leadTimeDays" | "weight" | "length" | "width" | "height"> = ["qty", "unitCost", "price", "salePrice", "minQty", "maxQty", "leadTimeDays", "weight", "length", "width", "height"];

/** "1", "true", "yes", "published" → true; "0", "-1", "false", "no", "draft", "private" → false; anything else → undefined. */
export function parsePublished(raw: string | undefined): boolean | undefined {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return undefined;
  if (["1", "true", "yes", "y", "published", "active", "enabled", "visible"].includes(s)) return true;
  if (["0", "-1", "false", "no", "n", "draft", "private", "pending", "inactive", "disabled", "hidden", "archived"].includes(s)) return false;
  return undefined;
}

/** Convert one source row into an ImportRow using the target->header map. Unparsable numbers are dropped and reported. */
export function convertRow(src: Record<string, string>, cols: Partial<Record<TargetField, string>>, custom: Array<{ name: string; header: string }> = [], source?: "shopify" | "woocommerce"): { row: ImportRow; errors: string[] } {
  const errors: string[] = [];
  const read = (field: TargetField): string | undefined => {
    const header = cols[field];
    if (header === undefined) return undefined;
    const v = src[header];
    return v === undefined ? undefined : String(v).trim();
  };

  const row: ImportRow = { sku: read("sku") ?? "" };
  for (const f of TEXT_FIELDS) {
    const v = read(f);
    if (v) row[f] = v;
  }
  for (const f of NUMBER_FIELDS) {
    const parsed = parseLenientNumber(read(f));
    if (parsed.error) errors.push(`${FIELD_LABELS[f]}: ${parsed.error}`);
    else if (parsed.value !== undefined) row[f] = parsed.value;
  }
  if (cols.type !== undefined) {
    const t = normalizeItemType(read("type"));
    if (t) row.type = t;
  }
  if (cols.tags !== undefined) {
    const tags = splitTags(read("tags"));
    if (tags.length) row.tags = tags;
  }
  if (cols.published !== undefined) {
    const p = parsePublished(read("published"));
    if (p !== undefined) row.published = p;
  }
  if (row.externalId && source) row.externalSource = source;
  if (custom.length) {
    const attrs: Record<string, string> = {};
    for (const c of custom) {
      const v = src[c.header];
      if (v !== undefined && String(v).trim() !== "") attrs[c.name] = String(v).trim();
    }
    if (Object.keys(attrs).length) row.attributes = attrs;
  }
  return { row, errors };
}

const COMPARABLE: Array<keyof ImportRow & keyof Item> = ["name", "description", "category", "type", "unit", "unitCost", "price", "salePrice", "minQty", "maxQty", "leadTimeDays", "location", "barcode", "brand", "weight", "imageUrl"];

/** Fields whose incoming value differs from what the existing item has. */
export function changedFields(row: ImportRow, existing: Item): string[] {
  const out: string[] = [];
  for (const f of COMPARABLE) {
    const incoming = row[f];
    if (incoming === undefined) continue;
    const current = existing[f];
    if (typeof incoming === "number" ? Number(current ?? NaN) !== incoming : String(current ?? "").trim() !== String(incoming).trim()) out.push(f);
  }
  if (row.tags && row.tags.join("|") !== existing.tags.join("|")) out.push("tags");
  if (row.published === false && existing.status !== "inactive") out.push("status");
  for (const [k, v] of Object.entries(row.attributes ?? {})) if ((existing.attributes?.[k] ?? "") !== v) out.push(`custom:${k}`);
  return out;
}

/** Turn source rows into review rows with a New / Update / Error status. */
export function buildReviewRows(rows: Record<string, string>[], mapping: ColumnMapping, itemsBySku: Map<string, Item>, source?: "shopify" | "woocommerce"): ReviewRow[] {
  const cols = invertMapping(mapping);
  const custom = customColumns(mapping);
  const seen = new Map<string, number>();
  return rows.map((src, i) => {
    const line = i + 1;
    const { row, errors } = convertRow(src, cols, custom, source);
    const sku = row.sku.trim().toUpperCase();
    const existing = sku ? itemsBySku.get(sku) : undefined;
    if (!sku) errors.unshift("Missing SKU");
    else {
      const dup = seen.get(sku);
      if (dup !== undefined) errors.unshift(`Duplicate SKU, already on row ${dup}`);
      else seen.set(sku, line);
    }
    if (sku && !existing && !row.name?.trim()) errors.push("Name is required for new items");
    const status: ReviewRow["status"] = errors.length ? "error" : existing ? "update" : "new";
    return { line, sku, status, message: errors.length ? errors.join("; ") : undefined, row, existing, changedFields: existing && !errors.length ? changedFields(row, existing) : [] };
  });
}
