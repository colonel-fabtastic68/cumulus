import type { Item, PurchaseOrder, Supplier } from "@/lib/types";
import type { Store } from "@/lib/store/types";
import { createItems, InventoryError, upsertSupplier, type Actor } from "@/lib/inventory";
import { createPurchaseOrder, detectTemplateColumns } from "@/lib/purchaseOrders";
import { addItemSupplier, supplierLinkFor } from "@/lib/suppliers";
import { headerRowIndex } from "@/lib/spreadsheet";
import { round } from "@/lib/utils";

/**
 * Uploading a purchase order (feature `poUpload`): a document is read into a
 * `PurchaseOrderReading` (by Strato for PDFs and photos, here for a plain
 * sheet), matched against the catalog into a draft, checked by a person, and
 * only then written as an ordinary purchase order.
 *
 * Matching is plain lookups, so the same document always gives the same
 * draft. A line is filled in only when a printed code is exactly one item's
 * SKU, supplier part number, barcode or cross-reference; a look-alike name is
 * offered as a suggestion and never applied without a click.
 */

/** One ordered line as printed. Numbers are left out when the document does not show them. */
export interface ReadLine {
  /** Every part number, SKU or catalog number printed on the line. */
  codes: string[];
  description: string;
  qty?: number;
  unit?: string;
  unitCost?: number;
  lineTotal?: number;
}

/** A purchasing document as read: text and numbers as printed, nothing matched yet. */
export interface PurchaseOrderReading {
  /** "purchase order", "quote", "order confirmation", "invoice", "spreadsheet"… */
  documentType: string;
  supplier: string;
  /** A supplier on file the reader recognized as the same company, by its name on file. */
  knownSupplier?: string;
  /** The buyer's own order number, when the document carries one. */
  poNumber: string;
  /** The supplier's quote, confirmation or invoice number. */
  reference: string;
  /** YYYY-MM-DD, or empty. */
  expectedDate: string;
  terms: string;
  /** ISO 4217 when the document names a currency. */
  currency: string;
  note: string;
  lines: ReadLine[];
  subtotal?: number;
  shipping?: number;
  tax?: number;
  total?: number;
  /** Things the person should check, in plain sentences. */
  warnings: string[];
  /** 0–1: how legible the source was. */
  confidence: number;
}

export type MatchKind = "sku" | "supplierSku" | "barcode" | "crossRef";

export const MATCH_LABEL: Record<MatchKind, string> = { sku: "SKU", supplierSku: "supplier part number", barcode: "barcode", crossRef: "cross-reference" };

export interface DraftLine {
  codes: string[];
  description: string;
  unit?: string;
  qty?: number;
  unitCost?: number;
  /** Where the unit cost came from: printed, worked out from the printed line total, or not on the document. */
  costFrom: "document" | "lineTotal" | "none";
  lineTotal?: number;
  /** Set when a printed code is exactly one active item. */
  item?: Item;
  matchedBy?: MatchKind;
  matchedCode?: string;
  /** No code matched; this item's name is the closest. Offered, never applied on its own. */
  suggestion?: Item;
  /** A printed code belongs to an item that is inactive or superseded. */
  retired?: Item;
}

export interface PurchaseOrderDraft {
  /** The supplier on file when one matched, else the name as printed. */
  supplierName: string;
  supplier?: Supplier;
  /** The supplier's name as the document prints it. */
  printedSupplier: string;
  number: string;
  reference: string;
  expectedAt: string;
  terms: string;
  note: string;
  lines: DraftLine[];
  /** What the item lines should add up to according to the document, when it prints a subtotal or a total. */
  documentLinesTotal?: number;
  totals: Pick<PurchaseOrderReading, "subtotal" | "shipping" | "tax" | "total">;
  warnings: string[];
}

// ---- matching ----------------------------------------------------------------

const exactKey = (s: string) => s.trim().toLowerCase();
/** Letters and digits only, so "ENC 125B-RAW" and "enc125braw" compare equal. */
const looseKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

const KIND_RANK: Record<MatchKind, number> = { sku: 0, supplierSku: 1, barcode: 2, crossRef: 3 };

interface Hit {
  item: Item;
  kind: MatchKind;
  /** The supplier this part number belongs to, for supplier part numbers. */
  supplierId?: string;
}

interface CodeIndex {
  exact: Map<string, Hit[]>;
  loose: Map<string, Hit[]>;
}

function buildIndex(items: Item[]): CodeIndex {
  const exact = new Map<string, Hit[]>();
  const loose = new Map<string, Hit[]>();
  const add = (code: string | undefined, hit: Hit) => {
    if (!code?.trim()) return;
    const e = exactKey(code);
    exact.set(e, [...(exact.get(e) ?? []), hit]);
    const l = looseKey(code);
    // Short codes lose too much without their punctuation to be trusted.
    if (l.length >= 4) loose.set(l, [...(loose.get(l) ?? []), hit]);
  };
  for (const item of items) {
    add(item.sku, { item, kind: "sku" });
    add(item.supplierSku, { item, kind: "supplierSku", supplierId: item.supplierId });
    for (const s of item.suppliers ?? []) add(s.supplierSku, { item, kind: "supplierSku", supplierId: s.supplierId });
    add(item.barcode, { item, kind: "barcode" });
    for (const r of item.crossRefs ?? []) add(r.number, { item, kind: "crossRef" });
  }
  return { exact, loose };
}

/** The best hits for one code: the strongest kind of match, and this supplier's own part number over another supplier's. */
function bestHits(hits: Hit[], supplierId?: string): Hit[] {
  if (hits.length === 0) return [];
  const score = (h: Hit) => KIND_RANK[h.kind] * 2 + (h.kind === "supplierSku" && supplierId && h.supplierId !== supplierId ? 1 : 0);
  const best = Math.min(...hits.map(score));
  const top = hits.filter((h) => score(h) === best);
  // The same item reached twice (primary and secondary supplier link) is one answer.
  return top.filter((h, i) => top.findIndex((x) => x.item.id === h.item.id) === i);
}

function matchCodes(codes: string[], index: CodeIndex, supplierId?: string): { item?: Item; matchedBy?: MatchKind; matchedCode?: string; retired?: Item } {
  let found: { hit: Hit; code: string } | null = null;
  let ambiguous = false;
  for (const code of codes) {
    const exact = bestHits(index.exact.get(exactKey(code)) ?? [], supplierId);
    const hits = exact.length ? exact : bestHits(index.loose.get(looseKey(code)) ?? [], supplierId);
    if (hits.length === 0) continue;
    if (hits.length > 1) {
      ambiguous = true;
      continue;
    }
    const hit = hits[0]!;
    if (!found || KIND_RANK[hit.kind] < KIND_RANK[found.hit.kind]) found = { hit, code };
    else if (KIND_RANK[hit.kind] === KIND_RANK[found.hit.kind] && hit.item.id !== found.hit.item.id) ambiguous = true;
  }
  // Two codes on one line pointing at two different items: leave it to the person.
  if (!found || (ambiguous && found.hit.kind !== "sku")) return {};
  if (found.hit.item.status !== "active") return { retired: found.hit.item };
  return { item: found.hit.item, matchedBy: found.hit.kind, matchedCode: found.code };
}

const STOP_WORDS = new Set(["the", "and", "for", "with", "per", "pcs", "each", "pack", "box", "new"]);

function nameWords(s: string): string[] {
  const out = new Set<string>();
  for (const raw of s.toLowerCase().replace(/[^a-z0-9.]+/g, " ").split(" ")) {
    const w = raw.replace(/^\.+|\.+$/g, "");
    if (w.length < 2 || STOP_WORDS.has(w)) continue;
    out.add(w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
  }
  return [...out];
}

/** The one active item whose name shares most of its words with the description, when it is clearly ahead of the rest. */
function suggestByName(description: string, items: Item[], words: Map<string, string[]>): Item | undefined {
  const present = new Set(nameWords(description));
  if (present.size < 2) return undefined;
  let best: { item: Item; score: number; hits: number } | null = null;
  let tied = false;
  for (const item of items) {
    if (item.status !== "active") continue;
    const w = words.get(item.id) ?? [];
    const hits = w.filter((x) => present.has(x)).length;
    if (hits < 2) continue;
    const score = hits / w.length;
    if (score < 0.6) continue;
    if (!best || score > best.score || (score === best.score && hits > best.hits)) {
      best = { item, score, hits };
      tied = false;
    } else if (score === best.score && hits === best.hits) tied = true;
  }
  return best && !tied ? best.item : undefined;
}

/** The active item at the end of a superseded part's chain of replacements. */
function replacementFor(item: Item, items: Item[]): Item | undefined {
  const byId = new Map(items.map((i) => [i.id, i]));
  let next = item.supersededBy ? byId.get(item.supersededBy) : undefined;
  for (let hops = 0; next && next.status !== "active" && hops < 10; hops++) next = next.supersededBy ? byId.get(next.supersededBy) : undefined;
  return next?.status === "active" ? next : undefined;
}

const COMPANY_SUFFIX = /\b(inc|incorporated|llc|ltd|limited|co|corp|corporation|company|gmbh|plc|pty)\b/g;
const supplierKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(COMPANY_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();

/** The supplier on file a printed name means: the same name, the same name without "Inc." and punctuation, or the one the reader recognized. */
export function matchSupplier(name: string, suppliers: Supplier[], known?: string): Supplier | undefined {
  const exact = suppliers.find((s) => exactKey(s.name) === exactKey(name));
  if (exact) return exact;
  const key = supplierKey(name);
  const same = key ? suppliers.filter((s) => supplierKey(s.name) === key) : [];
  if (same.length === 1) return same[0];
  return known ? suppliers.find((s) => exactKey(s.name) === exactKey(known)) : undefined;
}

const validDate = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : "");
const positive = (n: number | undefined) => (n !== undefined && Number.isFinite(n) && n > 0 ? n : undefined);
const nonNegative = (n: number | undefined) => (n !== undefined && Number.isFinite(n) && n >= 0 ? n : undefined);

/** Matches a reading against the catalog and the suppliers on file. Nothing is written. */
export function draftFromReading(reading: PurchaseOrderReading, ctx: { items: Item[]; suppliers: Supplier[]; currency?: string }): PurchaseOrderDraft {
  const supplier = matchSupplier(reading.supplier, ctx.suppliers, reading.knownSupplier);
  const index = buildIndex(ctx.items);
  const words = new Map(ctx.items.map((i) => [i.id, nameWords(i.name)]));

  const lines: DraftLine[] = reading.lines.map((l) => {
    const codes = l.codes.map((c) => c.trim()).filter(Boolean);
    const qty = positive(l.qty);
    const lineTotal = nonNegative(l.lineTotal);
    const printed = nonNegative(l.unitCost);
    const derived = printed === undefined && lineTotal !== undefined && qty ? round(lineTotal / qty, 4) : undefined;
    const match = matchCodes(codes, index, supplier?.id);
    const description = l.description.trim();
    return {
      codes,
      description,
      unit: l.unit?.trim() || undefined,
      qty,
      unitCost: printed ?? derived,
      costFrom: printed !== undefined ? "document" : derived !== undefined ? "lineTotal" : "none",
      lineTotal,
      ...match,
      // A superseded part points at its replacement; otherwise the closest name, when no code matched at all.
      suggestion: match.item ? undefined : match.retired ? replacementFor(match.retired, ctx.items) : suggestByName([description, ...codes].join(" "), ctx.items, words),
    };
  });

  const warnings = [...reading.warnings];
  if (reading.confidence < 0.6) warnings.unshift("The document was hard to read. Check every number against it.");
  const docCurrency = reading.currency.trim().toUpperCase();
  if (docCurrency && ctx.currency && docCurrency !== ctx.currency.toUpperCase()) warnings.push(`The document is in ${docCurrency}; this workspace keeps money in ${ctx.currency.toUpperCase()}. Costs are copied as printed, not converted.`);
  const extras = [reading.shipping ? "shipping" : "", reading.tax ? "tax" : ""].filter(Boolean);
  if (extras.length) warnings.push(`The document also lists ${extras.join(" and ")}. A purchase order here holds item lines only, so ${extras.length > 1 ? "they are" : "it is"} left out of the total.`);

  const { subtotal, shipping, tax, total } = reading;
  const documentLinesTotal = nonNegative(subtotal) ?? (nonNegative(total) !== undefined ? round(total! - (shipping ?? 0) - (tax ?? 0)) : undefined);

  return {
    supplierName: supplier?.name ?? reading.supplier.trim(),
    supplier,
    printedSupplier: reading.supplier.trim(),
    number: reading.poNumber.trim(),
    reference: reading.reference.trim(),
    expectedAt: validDate(reading.expectedDate.trim()),
    terms: reading.terms.trim() || supplier?.terms || "",
    note: reading.note.trim(),
    lines,
    documentLinesTotal,
    totals: { subtotal, shipping, tax, total },
    warnings,
  };
}

/**
 * A purchasing document carries its own checksums: quantity times unit cost is the line total, and
 * the line totals add up to the subtotal. true = every figure that can be checked agrees, false =
 * one does not (a misread digit, a skipped line), null = the document prints nothing to check against.
 */
export function readingAddsUp(reading: Pick<PurchaseOrderReading, "lines" | "subtotal" | "shipping" | "tax" | "total">): boolean | null {
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.02, Math.abs(b) * 0.001);
  let checked = 0;
  let sumOfLines = 0;
  let sumKnown = reading.lines.length > 0;
  for (const l of reading.lines) {
    const worked = l.qty !== undefined && l.unitCost !== undefined ? l.qty * l.unitCost : undefined;
    if (worked !== undefined && l.lineTotal !== undefined) {
      checked++;
      if (!close(worked, l.lineTotal)) return false;
    }
    const amount = l.lineTotal ?? worked;
    if (amount === undefined) sumKnown = false;
    else sumOfLines += amount;
  }
  const expected = reading.subtotal ?? (reading.total !== undefined ? reading.total - (reading.shipping ?? 0) - (reading.tax ?? 0) : undefined);
  if (sumKnown && expected !== undefined) {
    checked++;
    if (!close(sumOfLines, expected)) return false;
  }
  return checked > 0 ? true : null;
}

const UNIT_ALIASES: Record<string, string> = { each: "ea", pc: "ea", pcs: "ea", piece: "ea", pieces: "ea", unit: "ea", units: "ea", foot: "ft", feet: "ft", meter: "m", meters: "m", metre: "m", metres: "m", kilogram: "kg", kilograms: "kg", pound: "lb", pounds: "lb", lbs: "lb", cs: "case", cases: "case", boxes: "box", bx: "box", rolls: "roll", rl: "roll" };

/** "EACH", "pcs" and "ea" are one unit; so are "FT" and "feet". */
export function normalizeUnit(unit: string | undefined): string {
  const u = (unit ?? "").trim().toLowerCase().replace(/\.$/, "");
  return UNIT_ALIASES[u] ?? u;
}

/** Whether the document counts a line in a different unit than the item is stocked in (a case against eaches). */
export function unitDiffers(printed: string | undefined, item: Pick<Item, "unit">): boolean {
  const p = normalizeUnit(printed);
  return !!p && p !== normalizeUnit(item.unit);
}

// ---- a plain sheet, read without a model ---------------------------------------

function parseNumber(v: string | undefined): number | undefined {
  const digits = (v ?? "").replace(/[^0-9.\-]/g, "");
  if (!digits) return undefined;
  const n = Number(digits);
  return Number.isFinite(n) ? n : undefined;
}

const headerKey = (h: string) => h.toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();
const DESCRIPTION_HEADERS = new Set(["description", "item description", "name", "item name", "product", "product name", "part name", "title", "details"]);
const EXTRA_CODE_HEADER = /(supplier|vendor|mfr|mfg|manufacturer)\s*(sku|part|pn|p n|number|no|#|code|item)|^(mpn|barcode|upc|ean)$/;
const PO_NUMBER_HEADERS = new Set(["po", "po number", "po #", "po no", "purchase order", "purchase order number", "order number", "order #"]);
const TOTAL_HEADERS = new Set(["total", "line total", "amount", "extended", "ext price", "extended price", "ext cost", "extended cost"]);
const UNIT_HEADERS = new Set(["unit", "uom", "units of measure", "unit of measure", "um"]);

/** The one value a column holds on every row that has one, or "" when rows disagree. */
function agreed(rows: string[][], col: number): string {
  if (col < 0) return "";
  const values = new Set(rows.map((r) => (r[col] ?? "").trim()).filter(Boolean));
  return values.size === 1 ? [...values][0]! : "";
}

/**
 * A sheet that already is a table of order lines (a header row with a part
 * number column and a quantity column) is read on the spot. Anything else
 * (title lines above the table, no recognizable columns) returns null, and
 * the caller hands the sheet to Strato instead.
 */
export function readingFromSheet(grid: string[][]): PurchaseOrderReading | null {
  const table = grid.filter((r) => r.some((c) => c.trim()));
  if (table.length < 2 || headerRowIndex(table) !== 0) return null;
  const headers = table[0]!.map((h) => h.trim());
  const cols = detectTemplateColumns(headers.filter(Boolean));
  if (!cols.sku || !cols.qty) return null;
  const at = (name: string | undefined) => (name ? headers.indexOf(name) : -1);
  const keys = headers.map(headerKey);
  const skuCol = at(cols.sku);
  const qtyCol = at(cols.qty);
  const costCol = at(cols.unitCost);
  const descCol = keys.findIndex((k, i) => i !== skuCol && DESCRIPTION_HEADERS.has(k));
  const extraCodeCols = keys.map((k, i) => (i !== skuCol && EXTRA_CODE_HEADER.test(k) ? i : -1)).filter((i) => i >= 0);
  const totalCol = keys.findIndex((k, i) => i !== costCol && TOTAL_HEADERS.has(k));
  const unitCol = keys.findIndex((k) => UNIT_HEADERS.has(k));
  const body = table.slice(1);

  const lines: ReadLine[] = [];
  let skipped = 0;
  for (const r of body) {
    const code = (r[skuCol] ?? "").trim();
    const qty = parseNumber(r[qtyCol]);
    if (!code && !(descCol >= 0 && r[descCol]?.trim())) continue;
    if (!qty || qty <= 0) {
      skipped++;
      continue;
    }
    lines.push({
      codes: [code, ...extraCodeCols.map((i) => (r[i] ?? "").trim())].filter(Boolean),
      description: descCol >= 0 ? (r[descCol] ?? "").trim() : "",
      qty,
      unit: unitCol >= 0 ? (r[unitCol] ?? "").trim() || undefined : undefined,
      unitCost: costCol >= 0 ? parseNumber(r[costCol]) : undefined,
      lineTotal: totalCol >= 0 ? parseNumber(r[totalCol]) : undefined,
    });
  }
  if (lines.length === 0) return null;
  return {
    documentType: "spreadsheet",
    supplier: agreed(body, at(cols.supplier)),
    poNumber: agreed(body, keys.findIndex((k) => PO_NUMBER_HEADERS.has(k))),
    reference: "",
    expectedDate: "",
    terms: "",
    currency: "",
    note: "",
    lines,
    warnings: skipped ? [`${skipped} row${skipped === 1 ? "" : "s"} had no quantity and ${skipped === 1 ? "was" : "were"} left out.`] : [],
    confidence: 1,
  };
}

/** A sheet's cells as tab-separated text, for Strato to read when the sheet is more than a plain table. */
export function sheetText(grid: string[][], maxChars = 180_000): string {
  return grid
    .map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, " ")).join("\t"))
    .join("\n")
    .slice(0, maxChars);
}

// ---- signing off ---------------------------------------------------------------

export interface UploadedLineInput {
  /** An item already in the catalog… */
  itemId?: string;
  /** …or one to create with the order. */
  newItem?: { sku: string; name: string; unit?: string; supplierSku?: string };
  qty: number;
  unitCost: number;
  /**
   * The document's part number for a line the person matched by hand. It is saved on the item as
   * this supplier's part number, so the supplier's next document matches on its own.
   */
  rememberCode?: string;
}

export interface UploadedPurchaseOrderInput {
  supplierId?: string;
  supplier: string;
  /** Leave blank for the next PO number. */
  number?: string;
  expectedAt?: string;
  terms?: string;
  reference?: string;
  note?: string;
  send?: boolean;
  lines: UploadedLineInput[];
}

export function purchaseOrderNumberTaken(purchaseOrders: Array<Pick<PurchaseOrder, "number">>, number: string): boolean {
  const n = exactKey(number);
  return !!n && purchaseOrders.some((p) => exactKey(p.number) === n);
}

/**
 * Writes a checked upload as a purchase order. Everything is validated before
 * the first write; then a new supplier and any new items are created, and the
 * order is created through the same function as a typed one.
 */
export async function addUploadedPurchaseOrder(store: Store, actor: Actor, input: UploadedPurchaseOrderInput): Promise<{ po: PurchaseOrder; createdItems: Item[]; createdSupplier?: Supplier; remembered: number }> {
  const supplierName = input.supplier.trim();
  if (!supplierName) throw new InventoryError("Choose a supplier for the purchase order");
  if (input.lines.length === 0) throw new InventoryError("A purchase order needs at least one line");
  const [items, purchaseOrders] = await Promise.all([store.list("items"), store.list("purchaseOrders")]);
  const number = input.number?.trim() ?? "";
  if (number && purchaseOrderNumberTaken(purchaseOrders, number)) throw new InventoryError(`${number} is already a purchase order here. Change the number, or leave it blank for the next one.`);

  const taken = new Set(items.map((i) => i.sku.toUpperCase()));
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const l of input.lines) {
    const label = l.newItem?.sku.trim() || (l.itemId ? byId.get(l.itemId)?.sku : "") || "a line";
    if (!l.itemId && !l.newItem) throw new InventoryError("Every line needs an item");
    if (l.itemId && !byId.has(l.itemId)) throw new InventoryError(`Unknown item ${l.itemId}`);
    if (!Number.isFinite(l.qty) || l.qty <= 0) throw new InventoryError(`Quantity for ${label} must be positive`);
    if (!Number.isFinite(l.unitCost) || l.unitCost < 0) throw new InventoryError(`Enter a unit cost for ${label}`);
    if (l.newItem) {
      const sku = l.newItem.sku.trim().toUpperCase();
      if (!sku || !l.newItem.name.trim()) throw new InventoryError("A new item needs a SKU and a name");
      if (taken.has(sku)) throw new InventoryError(`SKU ${sku} already exists. Pick that item for the line, or give the new one another SKU.`);
      taken.add(sku);
    }
  }

  let supplierId = input.supplierId;
  let createdSupplier: Supplier | undefined;
  if (!supplierId) {
    createdSupplier = await upsertSupplier(store, actor, { name: supplierName, terms: input.terms?.trim() || undefined });
    supplierId = createdSupplier.id;
  }

  const fresh = input.lines.filter((l) => l.newItem);
  const createdItems = fresh.length
    ? await createItems(
        store,
        actor,
        fresh.map((l) => ({ sku: l.newItem!.sku, name: l.newItem!.name, unit: normalizeUnit(l.newItem!.unit) || undefined, unitCost: l.unitCost, supplierId, supplierSku: l.newItem!.supplierSku?.trim() || undefined })),
      )
    : [];
  const createdBySku = new Map(createdItems.map((i) => [i.sku, i.id]));

  // Before the order is written, so its lines print the supplier's part number. A part number already on file for this supplier is never replaced.
  const remembered = new Set<string>();
  for (const l of input.lines) {
    const item = l.itemId ? byId.get(l.itemId) : undefined;
    const code = l.rememberCode?.trim();
    if (!item || !code || remembered.has(item.id) || code.toLowerCase() === item.sku.toLowerCase() || supplierLinkFor(item, supplierId)?.supplierSku) continue;
    remembered.add(item.id);
    await addItemSupplier(store, actor, item, { supplierId, supplierSku: code });
  }

  const po = await createPurchaseOrder(store, actor, {
    supplierId,
    supplier: supplierName,
    number: number || undefined,
    lines: input.lines.map((l) => ({ itemId: l.itemId ?? createdBySku.get(l.newItem!.sku.trim().toUpperCase())!, qty: l.qty, unitCost: l.unitCost })),
    expectedAt: input.expectedAt,
    terms: input.terms,
    reference: input.reference,
    note: input.note,
    source: "upload",
    send: input.send,
  });
  return { po, createdItems, createdSupplier, remembered: remembered.size };
}
