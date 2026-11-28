/**
 * BOM import from a spreadsheet (feature `bomImport`).
 *
 * One row per component: the assembly's part number, the component's part number, the quantity,
 * and optionally expected waste and a note. A blank assembly cell repeats the one above, so a sheet
 * grouped by assembly (the way Fishbowl and most hand-made BOM sheets look) reads as it is printed.
 *
 * Both part numbers must already be items; import items first. An assembly that is a plain part
 * today becomes an assembly. Each assembly's list either replaces its current BOM or is added to
 * it. An assembly with any row that cannot be used is held back whole, never imported half done,
 * and lists that would put an assembly inside itself are refused; both say why.
 * Plain functions, no React.
 */

import type { BomLine, Item } from "@/lib/types";
import type { Store, WriteOp } from "@/lib/store/types";
import { activityOp, type Actor } from "@/lib/inventory";
import { mergeBomLines, resolveImportBoms, type ImportBomLine, type PendingBom } from "@/lib/importBoms";
import { nowIso, round } from "@/lib/utils";

export const BOM_IMPORT_FIELDS = ["assembly", "component", "qty", "wastePct", "note"] as const;
export type BomImportField = (typeof BOM_IMPORT_FIELDS)[number];
export type BomImportMapping = Partial<Record<BomImportField, string>>;

export const BOM_IMPORT_LABELS: Record<BomImportField, string> = {
  assembly: "Assembly part number",
  component: "Component part number",
  qty: "Quantity per assembly",
  wastePct: "Expected waste %",
  note: "Note",
};

export const BOM_IMPORT_REQUIRED: readonly BomImportField[] = ["assembly", "component", "qty"];

const HINTS: Record<BomImportField, RegExp> = {
  assembly: /^(parent|assembly|assy|top|finished|fg|kit|product|bom)\b.*|.*\b(parent|assembly|assy)\b.*/i,
  component: /^(child|component|comp|part|item|material|raw|ingredient)\b.*|.*\b(child|component)\b.*/i,
  qty: /^(qty|quantity|amount|count|per|usage|qty\s*per)\b.*|.*\b(qty|quantity)\b.*/i,
  wastePct: /waste|scrap|loss|yield/i,
  note: /note|comment|remark|description|memo/i,
};

/** Best-guess column mapping from the sheet's headers. */
export function guessBomMapping(headers: string[]): BomImportMapping {
  const out: BomImportMapping = {};
  const taken = () => new Set(Object.values(out));
  for (const field of BOM_IMPORT_FIELDS) {
    const h = headers.find((x) => x.trim() && HINTS[field].test(x.trim()) && !taken().has(x));
    if (h) out[field] = h;
  }
  return out;
}

function parseNumber(value: string | undefined): number | undefined {
  const v = (value ?? "").replace(/[,%\s]/g, "");
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export type BomImportMode = "replace" | "add";

export interface PlannedBom {
  assembly: Item;
  /** The BOM the assembly will have. */
  bom: BomLine[];
  /** First sheet row (1-based, after the header) for this assembly. */
  row: number;
  /** Lines the file gave this assembly. */
  fileLines: number;
  /** Lines on the BOM today. */
  linesBefore: number;
  /** A plain part today; becomes an assembly. */
  becomesAssembly: boolean;
  /** What the import does to each component of the list. */
  diff: BomDiff;
}

/** One component in a before/after comparison of a parts list. */
export interface BomLineChange {
  itemId: string;
  sku: string;
  name: string;
  /** The component's stocking unit. */
  unit: string;
  /** Quantity before (absent when added). */
  from?: number;
  /** Quantity after (absent when removed). */
  to?: number;
}

export interface BomDiff {
  added: BomLineChange[];
  removed: BomLineChange[];
  changed: BomLineChange[];
  /** Lines with the same quantity before and after. */
  unchanged: number;
}

/** Lines the import touches (added, removed or a different quantity). */
export function diffCount(d: BomDiff): number {
  return d.added.length + d.removed.length + d.changed.length;
}

/** Component by component, what turns `before` into `after`. Quantities are compared per component, summed when a list names one twice. */
export function diffBom(before: readonly BomLine[], after: readonly BomLine[], itemsById: ReadonlyMap<string, Item>): BomDiff {
  const total = (lines: readonly BomLine[]) => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty);
    return m;
  };
  const a = total(before);
  const b = total(after);
  const describe = (itemId: string, from?: number, to?: number): BomLineChange => {
    const item = itemsById.get(itemId);
    return { itemId, sku: item?.sku ?? itemId, name: item?.name ?? "", unit: item?.unit ?? "ea", ...(from !== undefined ? { from: round(from, 6) } : {}), ...(to !== undefined ? { to: round(to, 6) } : {}) };
  };
  const diff: BomDiff = { added: [], removed: [], changed: [], unchanged: 0 };
  for (const [id, to] of b) {
    const from = a.get(id);
    if (from === undefined) diff.added.push(describe(id, undefined, to));
    else if (Math.abs(from - to) > 1e-9) diff.changed.push(describe(id, from, to));
    else diff.unchanged++;
  }
  for (const [id, from] of a) if (!b.has(id)) diff.removed.push(describe(id, from));
  const bySku = (x: BomLineChange, y: BomLineChange) => x.sku.localeCompare(y.sku);
  diff.added.sort(bySku);
  diff.removed.sort(bySku);
  diff.changed.sort(bySku);
  return diff;
}

export interface BomImportPlan {
  boms: PlannedBom[];
  errors: Array<{ row: number; message: string }>;
  /** Rows with nothing in them, ignored. */
  blank: number;
}

/**
 * Read the sheet into one planned BOM per assembly. `items` is every item in the workspace.
 * Rows that cannot be used are reported with the row number. An assembly with any such row is
 * held back whole: a parts list missing a line would build wrong without anyone noticing.
 */
export function planBomImport(rows: ReadonlyArray<Record<string, string>>, mapping: BomImportMapping, items: readonly Item[], mode: BomImportMode): BomImportPlan {
  const bySku = new Map(items.map((i) => [i.sku.trim().toUpperCase(), i]));
  const errors: BomImportPlan["errors"] = [];
  const groups = new Map<string, { row: number; lines: Array<ImportBomLine & { wastePct?: number; note?: string }> }>();
  let blank = 0;
  let lastAssembly = "";
  /** Assemblies with a row that could not be used: held back whole. */
  const held = new Set<string>();

  rows.forEach((r, i) => {
    const row = i + 1;
    const cell = (f: BomImportField) => (mapping[f] ? (r[mapping[f]!] ?? "").trim() : "");
    const asmCell = cell("assembly");
    const comp = cell("component").toUpperCase();
    const qtyCell = cell("qty");
    if (!asmCell && !comp && !qtyCell) {
      blank++;
      return;
    }
    // A blank assembly cell repeats the one above (sheets grouped by assembly).
    const asm = (asmCell || lastAssembly).toUpperCase();
    if (asmCell) lastAssembly = asmCell;
    if (!asm) return void errors.push({ row, message: `No assembly part number for ${comp || "this row"}` });
    const fail = (message: string) => {
      held.add(asm);
      errors.push({ row, message });
    };
    if (!comp) return fail(`${asm}: no component part number`);
    if (!bySku.has(asm)) return fail(`${asm} is not in inventory. Import or add the item first`);
    if (!bySku.has(comp)) return fail(`${asm}: component ${comp} is not in inventory. Import or add the item first`);
    const qty = parseNumber(qtyCell);
    if (qty === undefined || Number.isNaN(qty) || qty <= 0) return fail(`${asm}: quantity for ${comp} must be a number more than zero (found "${qtyCell}")`);
    const waste = parseNumber(cell("wastePct"));
    if (waste !== undefined && (Number.isNaN(waste) || waste < 0 || waste >= 100)) return fail(`${asm}: waste for ${comp} must be a percentage from 0 to 99 (found "${cell("wastePct")}")`);
    const note = cell("note") || undefined;
    const g = groups.get(asm) ?? { row, lines: [] };
    g.lines.push({ sku: comp, qty, ...(waste !== undefined ? { wastePct: waste } : {}), ...(note ? { note } : {}) });
    groups.set(asm, g);
  });

  // In add mode, the current lines stay unless the file names the same component (the file's quantity wins).
  const skuOf = new Map(items.map((i) => [i.id, i.sku.trim().toUpperCase()]));
  const pending: PendingBom[] = [];
  for (const [asm, g] of groups) {
    if (held.has(asm)) {
      errors.push({ row: g.row, message: `${asm}: parts list not imported because of the problem${errors.filter((e) => e.message.startsWith(`${asm}:`) || e.message.startsWith(`${asm} `)).length === 1 ? "" : "s"} listed for it. Fix the sheet and import again` });
      continue;
    }
    const assembly = bySku.get(asm)!;
    const fromFile = mergeBomLines(g.lines);
    const inFile = new Set(fromFile.map((l) => l.sku));
    const kept = mode === "add" ? assembly.bom.flatMap((l) => {
      const sku = skuOf.get(l.itemId);
      return sku && !inFile.has(sku) ? [{ sku, qty: l.qty }] : [];
    }) : [];
    pending.push({ row: g.row, sku: asm, lines: [...kept, ...fromFile] });
  }
  const resolved = resolveImportBoms(pending, bySku);
  errors.push(...resolved.errors);

  const boms: PlannedBom[] = [];
  const itemsById = new Map(items.map((i) => [i.id, i]));
  for (const p of pending) {
    const assembly = bySku.get(p.sku)!;
    const bom = resolved.boms.get(assembly.id);
    if (!bom) continue;
    // Waste and note from the file, where given, on top of what the line kept.
    const extras = new Map<string, { wastePct?: number; note?: string }>();
    for (const l of groups.get(p.sku)!.lines) if (l.wastePct !== undefined || l.note) extras.set(l.sku, { ...(extras.get(l.sku) ?? {}), ...(l.wastePct !== undefined ? { wastePct: l.wastePct } : {}), ...(l.note ? { note: l.note } : {}) });
    const finished = bom.map((line) => ({ ...line, qty: round(line.qty, 6), ...(extras.get(skuOf.get(line.itemId) ?? "") ?? {}) }));
    boms.push({ assembly, bom: finished, row: p.row, fileLines: mergeBomLines(groups.get(p.sku)!.lines).length, linesBefore: assembly.bom.length, becomesAssembly: assembly.type !== "assembly", diff: diffBom(assembly.bom, finished, itemsById) });
  }
  boms.sort((a, b) => a.row - b.row);
  errors.sort((a, b) => a.row - b.row);
  return { boms, errors, blank };
}

/** Write the planned BOMs in one batch, with one Activity entry for the whole import. */
export async function importBoms(store: Store, actor: Actor, plan: BomImportPlan, sourceName: string): Promise<{ set: number; converted: number }> {
  if (plan.boms.length === 0) return { set: 0, converted: 0 };
  const now = nowIso();
  const converted = plan.boms.filter((b) => b.becomesAssembly).length;
  const ops: WriteOp[] = plan.boms.map((b) => ({
    op: "patch",
    collection: "items",
    id: b.assembly.id,
    patch: { bom: b.bom, ...(b.becomesAssembly ? { type: "assembly" } : {}), updatedAt: now, updatedBy: actor.id },
  }));
  ops.push(
    activityOp(actor, "import.completed", `${actor.name} imported parts lists for ${plan.boms.length} assembl${plan.boms.length === 1 ? "y" : "ies"} from ${sourceName}${converted ? ` (${converted} made assemblies)` : ""}`, {
      meta: { boms: plan.boms.length, converted, lines: plan.boms.reduce((a, b) => a + b.bom.length, 0), skipped: plan.errors.length },
    }),
  );
  await store.batch(ops);
  return { set: plan.boms.length, converted };
}
