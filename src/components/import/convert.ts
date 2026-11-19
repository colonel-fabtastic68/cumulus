import { skuFromName } from "@/lib/sku";
import { bomLinesProblem } from "@/lib/importBoms";
import type { ImportRow } from "@/lib/inventory";
import type { Item } from "@/lib/types";
import { uniq } from "@/lib/utils";
import { customColumns, invertMapping } from "./mapping";
import { FIELD_LABELS, type ColumnMapping, type ReviewRow, type RowEdit, type RowEdits, type TargetField } from "./types";

/** Apply a review-step edit on top of a converted row: values win over the file, null clears. Returns the fields touched. */
export function applyRowEdit(row: ImportRow, edit: RowEdit): string[] {
  const target = row as unknown as Record<string, unknown>;
  const touched: string[] = [];
  for (const [k, v] of Object.entries(edit)) {
    if (v === undefined) continue;
    touched.push(k);
    if (v === null) {
      if (k === "sku") row.sku = "";
      else delete target[k];
    } else target[k] = v;
  }
  // A part has no parts list.
  if (row.type === "part") delete row.bom;
  return touched;
}

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
  if (row.bom?.length) out.push("bom");
  for (const [k, v] of Object.entries(row.attributes ?? {})) if ((existing.attributes?.[k] ?? "") !== v) out.push(`custom:${k}`);
  return out;
}

/** Turn source rows into review rows with a New / Update / Error status. */
/** Lower-case name with single spaces, for matching an import row to an existing item by name. */
const nameKey = (s: string | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export function buildReviewRows(rows: Record<string, string>[], mapping: ColumnMapping, itemsBySku: Map<string, Item>, source?: "shopify" | "woocommerce", opts: { fillSkus?: boolean; overrides?: Map<number, Partial<ImportRow>>; edits?: RowEdits; skip?: ReadonlySet<number> } = {}): ReviewRow[] {
  const cols = invertMapping(mapping);
  const custom = customColumns(mapping);
  const seen = new Map<string, number>();
  const converted = rows.map((src, i) => {
    const c = convertRow(src, cols, custom, source);
    // Values Strato filled in (keyed by 1-based line) only land where the file left a blank.
    const extra = opts.overrides?.get(i + 1);
    if (extra) {
      const target = c.row as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(extra)) if (v !== undefined && k !== "sku" && target[k] === undefined) target[k] = v;
      if (extra.sku && !c.row.sku) c.row.sku = extra.sku;
    }
    // A person's own edits win over the file and over Strato; a field they set no longer carries the file's parse error.
    const edit = opts.edits?.get(i + 1);
    if (edit) {
      const touched = applyRowEdit(c.row, edit);
      const labels = touched.map((f) => (FIELD_LABELS as Record<string, string>)[f]).filter(Boolean);
      const errors = c.errors.filter((e) => !labels.some((l) => e.startsWith(`${l}:`)));
      return { row: c.row, errors, edited: touched.length > 0 };
    }
    return { ...c, edited: false };
  });
  // Rows without a SKU: an existing item with the same name keeps its SKU, otherwise one is made from the name,
  // unique among the workspace's SKUs and the file's own.
  const filled = new Map<number, "matched" | "made" | "strato">();
  converted.forEach((c, i) => {
    if (opts.overrides?.get(i + 1)?.sku && c.row.sku === opts.overrides.get(i + 1)?.sku) filled.set(i, "strato");
  });
  if (opts.fillSkus) {
    const byName = new Map<string, Item>();
    for (const item of itemsBySku.values()) if (!byName.has(nameKey(item.name))) byName.set(nameKey(item.name), item);
    const taken = new Set<string>([...itemsBySku.keys(), ...converted.map((c) => c.row.sku.trim().toUpperCase()).filter(Boolean)]);
    const madeForName = new Map<string, string>();
    converted.forEach((c, i) => {
      if (c.row.sku.trim() || !c.row.name?.trim()) return;
      const match = byName.get(nameKey(c.row.name));
      if (match) {
        c.row.sku = match.sku;
        filled.set(i, "matched");
        return;
      }
      // The same name twice in one file is one item: it gets one SKU (and the duplicate is reported as usual).
      const key = nameKey(c.row.name);
      c.row.sku = madeForName.get(key) ?? skuFromName(c.row.name, taken);
      madeForName.set(key, c.row.sku);
      filled.set(i, "made");
    });
  }
  // Lines left out of the import are dropped before duplicates are counted, so the copy that stays is not an error.
  const kept = rows.map((_, i) => i).filter((i) => !opts.skip?.has(i + 1));
  const checked = kept.map((i) => {
    const line = i + 1;
    const { row, errors, edited } = converted[i]!;
    const sku = row.sku.trim().toUpperCase();
    const existing = sku ? itemsBySku.get(sku) : undefined;
    if (!sku) errors.unshift("Missing SKU");
    else {
      const dup = seen.get(sku);
      if (dup !== undefined) errors.unshift(`Duplicate SKU, already on row ${dup}`);
      else seen.set(sku, line);
    }
    if (sku && !existing && !row.name?.trim()) errors.push("Name is required for new items");
    return { line, sku, existing, row, errors, edited, filled: filled.get(i) };
  });
  // Parts lists may only name items that will exist: ones already in inventory, or rows of this file that import cleanly.
  const known = new Set<string>(itemsBySku.keys());
  for (const c of checked) if (c.sku && c.errors.length === 0) known.add(c.sku);
  return checked.map(({ line, sku, existing, row, errors, edited, filled: how }) => {
    if (sku && row.bom?.length) {
      const problem = bomLinesProblem(sku, row.bom, known);
      if (problem) errors.push(problem);
    }
    const status: ReviewRow["status"] = errors.length ? "error" : existing ? "update" : "new";
    return { line, sku, ...(how ? { skuFilled: how } : {}), status, message: errors.length ? errors.join("; ") : undefined, row, existing, changedFields: existing && !errors.length ? changedFields(row, existing) : [], ...(edited ? { edited: true } : {}) };
  });
}
