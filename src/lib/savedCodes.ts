import type { Item, SavedCode } from "@/lib/types";
import type { Store, WriteOp } from "@/lib/store/types";
import { activityOp, InventoryError, type Actor } from "@/lib/inventory";
import { nowIso } from "@/lib/utils";
import { encodedText, itemEntry, type LabelEntry } from "@/lib/labels/entries";
import { effectiveSymbology, symbologyProblem } from "@/lib/labels/render";
import { DEFAULT_ITEM_DETAILS, DEFAULT_SPEC, SYMBOLOGIES, isTwoD, type EntryCode, type LabelSpec, type Symbology } from "@/lib/labels/spec";

/**
 * Saved codes (feature `savedCodes`): the barcode or QR code made for an item
 * under Labels & barcodes. One per item, kept on the item itself, so the list
 * there, the label sheets and the pick lists all draw the same code.
 *
 * A code is a choice (which symbology, what it carries, what is printed beside
 * it), not a picture: it is drawn from the item each time, so renaming the
 * item or changing its part number changes its label too.
 */

/** What a person chooses when making or editing a code; when and by whom is added on save. */
export type CodeChoice = Pick<SavedCode, "symbology" | "encode" | "fields" | "details" | "textScale">;

export const DEFAULT_CODE: CodeChoice = { symbology: "qrcode", encode: "link", fields: { name: true, code: true, price: false, detail: true }, textScale: 1 };

export type CodedItem = Item & { savedCode: SavedCode };

export function hasSavedCode(item: Item): item is CodedItem {
  return !!item.savedCode;
}

/** Items a code can be made for: everything still in use. */
export function codableItems(items: Item[]): Item[] {
  return items.filter((i) => i.status !== "superseded");
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * A choice as it is stored. Bars carry the item code on its own (a link is far too long for them),
 * UPC and EAN carry the item's barcode number, and defaults are left out so nothing is saved undefined.
 */
export function tidyChoice(c: CodeChoice): CodeChoice {
  const out: CodeChoice = {
    symbology: c.symbology,
    encode: isTwoD(c.symbology) ? c.encode : "code",
    fields: { name: !!c.fields.name, code: !!c.fields.code, price: !!c.fields.price, detail: !!c.fields.detail },
  };
  if (c.details && !sameList(c.details, DEFAULT_ITEM_DETAILS)) out.details = [...c.details];
  if (c.textScale && c.textScale !== 1) out.textScale = c.textScale;
  return out;
}

/** The choice behind a saved code, with the defaults filled back in for a form. */
export function choiceOf(code: SavedCode): CodeChoice {
  return { symbology: code.symbology, encode: code.encode, fields: { ...code.fields }, details: code.details ? [...code.details] : undefined, textScale: code.textScale ?? 1 };
}

/** A workspace's word for the item code inside a sentence: "part number", while "SKU" and "PN" stay as they are. */
export function midSentence(term: string): string {
  return /^[A-Z0-9#\s]+$/.test(term) ? term : term.toLowerCase();
}

export function symbologyLabel(s: Symbology): string {
  return SYMBOLOGIES.find((x) => x.id === s)?.label ?? s;
}

export function isRetail(s: Symbology): boolean {
  return s === "ean13" || s === "upca";
}

/** The label entry for an item with the details line this code asks for. */
export function codeEntry(item: Item, code: CodeChoice, supplierName?: (id: string) => string | undefined): LabelEntry {
  return itemEntry(item, item.type === "assembly" ? "assembly" : "item", { parts: code.details, supplierName });
}

export interface CodeDrawing {
  /** What the bars or squares carry. */
  text: string;
  /** The symbology actually drawn. */
  symbology: Symbology;
  /** True when Code 128 of the item code stands in, because the item has no number a UPC or EAN can carry. */
  standIn: boolean;
}

/** What gets drawn for an item's code. `origin` is the address a link opens ("https://app.cumulusos.com"). */
export function codeDrawing(item: Item, code: CodeChoice, origin: string): CodeDrawing {
  const text = encodedText(itemEntry(item), isTwoD(code.symbology) ? code.encode : "code", code.symbology, origin);
  const symbology = effectiveSymbology(code.symbology, text);
  return { text, symbology, standIn: symbology !== code.symbology };
}

/** Whether a UPC or EAN can be drawn for this item as it stands. */
export function retailReady(item: Pick<Item, "barcode">, symbology: Symbology): boolean {
  return !symbologyProblem(symbology, item.barcode?.replace(/\s+/g, "") ?? "");
}

/** How the data on a code reads in a list: "Link to cumulusOS", "PN", "Barcode number". */
export function carriesLabel(code: CodeChoice, itemCodeShort = "SKU"): string {
  if (isRetail(code.symbology)) return "Barcode number";
  return isTwoD(code.symbology) && code.encode === "link" ? "Link to cumulusOS" : itemCodeShort;
}

/** The text lines a code prints beside itself, as a short phrase: "Name, SKU, details". */
export function printedBeside(code: CodeChoice, itemCodeShort = "SKU"): string {
  const parts = [code.fields.name ? "Name" : null, code.fields.code ? itemCodeShort : null, code.fields.detail ? "details" : null, code.fields.price ? "price" : null].filter(Boolean);
  return parts.length ? parts.join(", ") : "Nothing";
}

/** A code as one record's entry on a label sheet. */
export function entryCode(code: CodeChoice): EntryCode {
  const tidy = tidyChoice(code);
  return { symbology: tidy.symbology, encode: tidy.encode, fields: tidy.fields, textScale: tidy.textScale ?? 1 };
}

export type SheetOptions = Pick<LabelSpec, "templateId" | "copies" | "startAt" | "border">;

/** The label sheet that prints each of these items with its own saved code. */
export function sheetFor(items: CodedItem[], sheet: SheetOptions, supplierName?: (id: string) => string | undefined): { spec: LabelSpec; entries: LabelEntry[] } {
  const perEntry: Record<string, EntryCode> = {};
  for (const i of items) perEntry[i.id] = entryCode(i.savedCode);
  return { spec: { ...DEFAULT_SPEC, kind: "item", ...sheet, textScale: 1, perEntry }, entries: items.map((i) => codeEntry(i, i.savedCode, supplierName)) };
}

// ---- Writing ----------------------------------------------------------------------------

function describe(n: number): string {
  return `${n} ${n === 1 ? "item" : "items"}`;
}

/** Make (or remake) the code for each item. Returns how many were made and how many of those replaced an older code. */
export async function saveCodes(store: Store, actor: Actor, itemIds: string[], choice: CodeChoice): Promise<{ made: number; replaced: number }> {
  if (itemIds.length === 0) throw new InventoryError("Choose at least one item to make a code for");
  const byId = new Map((await store.list("items")).map((i) => [i.id, i]));
  const tidy = tidyChoice(choice);
  const now = nowIso();
  const ops: WriteOp[] = [];
  let replaced = 0;
  for (const id of new Set(itemIds)) {
    const item = byId.get(id);
    if (!item) continue;
    if (item.savedCode) replaced++;
    const savedCode: SavedCode = { ...tidy, createdAt: now, createdBy: actor.id };
    ops.push({ op: "patch", collection: "items", id, patch: { savedCode } });
  }
  if (ops.length === 0) throw new InventoryError("Those items are no longer in the workspace");
  const made = ops.length;
  ops.push(activityOp(actor, "item.updated", `${actor.name} made ${symbologyLabel(tidy.symbology)} codes for ${describe(made)}`, { meta: { count: made, symbology: tidy.symbology, fields: ["savedCode"] } }));
  await store.batch(ops);
  return { made, replaced };
}

/** Change the codes these items already have. Items without one are left alone. Returns how many changed. */
export async function updateCodes(store: Store, actor: Actor, itemIds: string[], choice: CodeChoice): Promise<number> {
  const byId = new Map((await store.list("items")).map((i) => [i.id, i]));
  const tidy = tidyChoice(choice);
  const now = nowIso();
  const ops: WriteOp[] = [];
  for (const id of new Set(itemIds)) {
    const old = byId.get(id)?.savedCode;
    if (!old) continue;
    const savedCode: SavedCode = { ...tidy, createdAt: old.createdAt, ...(old.createdBy ? { createdBy: old.createdBy } : {}), updatedAt: now };
    ops.push({ op: "patch", collection: "items", id, patch: { savedCode } });
  }
  if (ops.length === 0) throw new InventoryError("None of those items has a code to change");
  const changed = ops.length;
  ops.push(activityOp(actor, "item.updated", `${actor.name} changed the codes for ${describe(changed)}`, { meta: { count: changed, symbology: tidy.symbology, fields: ["savedCode"] } }));
  await store.batch(ops);
  return changed;
}

/** Remove the saved code from these items. The items themselves are untouched. Returns how many were removed. */
export async function deleteCodes(store: Store, actor: Actor, itemIds: string[]): Promise<number> {
  const byId = new Map((await store.list("items")).map((i) => [i.id, i]));
  const ops: WriteOp[] = [];
  for (const id of new Set(itemIds)) {
    if (!byId.get(id)?.savedCode) continue;
    // A top-level undefined clears the field.
    ops.push({ op: "patch", collection: "items", id, patch: { savedCode: undefined } });
  }
  if (ops.length === 0) return 0;
  const removed = ops.length;
  ops.push(activityOp(actor, "item.updated", `${actor.name} deleted the codes for ${describe(removed)}`, { meta: { count: removed, fields: ["savedCode"] } }));
  await store.batch(ops);
  return removed;
}
