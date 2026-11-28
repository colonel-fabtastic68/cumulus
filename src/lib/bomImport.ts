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

import type { ActivityEvent, BomLine, Item } from "@/lib/types";
import type { Store, WriteOp } from "@/lib/store/types";
import { InventoryError, activityOp, type Actor } from "@/lib/inventory";
import { mergeBomLines, resolveImportBoms, type ImportBomLine, type PendingBom } from "@/lib/importBoms";
import { formatNumber } from "@/lib/format";
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
  /** Things worth a look that do not stop the import, e.g. two sheet rows for one component combined. */
  warnings: string[];
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
  /** Lines with the same quantity before and after that the sheet did not name. */
  unchanged: number;
  /** Add mode: lines the sheet named that already had that quantity ("1 → 1, unchanged"). */
  confirmed: BomLineChange[];
}

/** Lines the import touches (added, removed or a different quantity). */
export function diffCount(d: BomDiff): number {
  return d.added.length + d.removed.length + d.changed.length;
}

/**
 * Component by component, what turns `before` into `after`. Quantities are compared per component, summed when a
 * list names one twice. `named` (Add mode) lists the components the sheet named, so the ones it left at the same
 * quantity are shown rather than folded into the unchanged count.
 */
export function diffBom(before: readonly BomLine[], after: readonly BomLine[], itemsById: ReadonlyMap<string, Item>, named?: ReadonlySet<string>): BomDiff {
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
  const diff: BomDiff = { added: [], removed: [], changed: [], unchanged: 0, confirmed: [] };
  for (const [id, to] of b) {
    const from = a.get(id);
    if (from === undefined) diff.added.push(describe(id, undefined, to));
    else if (Math.abs(from - to) > 1e-9) diff.changed.push(describe(id, from, to));
    else if (named?.has(id)) diff.confirmed.push(describe(id, from, to));
    else diff.unchanged++;
  }
  for (const [id, from] of a) if (!b.has(id)) diff.removed.push(describe(id, from));
  const bySku = (x: BomLineChange, y: BomLineChange) => x.sku.localeCompare(y.sku);
  diff.added.sort(bySku);
  diff.removed.sort(bySku);
  diff.changed.sort(bySku);
  diff.confirmed.sort(bySku);
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
    // Two sheet rows for one component are added together; say so, since a doubled line doubles what a build pulls.
    const sheetLines = groups.get(p.sku)!.lines;
    const rowsPer = new Map<string, { n: number; qty: number }>();
    for (const l of sheetLines) rowsPer.set(l.sku, { n: (rowsPer.get(l.sku)?.n ?? 0) + 1, qty: round((rowsPer.get(l.sku)?.qty ?? 0) + l.qty, 6) });
    const warnings = [...rowsPer].filter(([, v]) => v.n > 1).map(([sku, v]) => `${v.n} rows for ${sku} combined → qty ${formatNumber(v.qty, 4)}`);
    const named = mode === "add" ? new Set(sheetLines.map((l) => bySku.get(l.sku)?.id).filter((id): id is string => !!id)) : undefined;
    boms.push({ assembly, bom: finished, row: p.row, fileLines: rowsPer.size, linesBefore: assembly.bom.length, becomesAssembly: assembly.type !== "assembly", diff: diffBom(assembly.bom, finished, itemsById, named), warnings });
  }
  boms.sort((a, b) => a.row - b.row);
  errors.sort((a, b) => a.row - b.row);
  return { boms, errors, blank };
}

// ---- Writing, the record of an import, and putting it back -------------------

/** What one assembly looked like before an import and what the import made it, kept on the import's Activity entry so it can be reverted. */
export interface BomImportEntry {
  itemId: string;
  sku: string;
  before: BomLine[];
  after: BomLine[];
  typeBefore: Item["type"];
  becameAssembly: boolean;
  /** One line for the assembly's own Recent activity. */
  summary: string;
}

export interface BomImportRecord {
  at: string;
  source: string;
  mode: BomImportMode;
  assemblies: BomImportEntry[];
}

/** One before/after row per line the import touched, for "Show details" on the Activity entry (ActivityFeed reads meta.changes). */
function changeLines(plan: BomImportPlan): Array<{ sku: string; field: string; from: number | string; to: number | string }> {
  return plan.boms.flatMap((b) => [
    ...b.diff.changed.map((c) => ({ sku: b.assembly.sku, field: `${c.sku} qty`, from: c.from!, to: c.to! })),
    ...b.diff.added.map((c) => ({ sku: b.assembly.sku, field: `${c.sku} added`, from: "", to: c.to! })),
    ...b.diff.removed.map((c) => ({ sku: b.assembly.sku, field: `${c.sku} removed`, from: c.from!, to: "" })),
  ]);
}

function entrySummary(b: PlannedBom, mode: BomImportMode): string {
  const d = b.diff;
  const verb = b.linesBefore === 0 ? "set" : mode === "replace" ? "replaced" : "updated";
  return `BOM ${verb} by import · ${d.changed.length} changed · ${d.added.length} added · ${d.removed.length} removed`;
}

/**
 * Write the planned BOMs in one batch with one Activity entry. The entry keeps every touched
 * assembly's list before and after (so "Revert this import" can put it back), the line-by-line
 * changes for its details, and a line per assembly for that assembly's own Recent activity.
 */
export async function importBoms(store: Store, actor: Actor, plan: BomImportPlan, sourceName: string, mode: BomImportMode): Promise<{ set: number; converted: number; activityId?: string }> {
  if (plan.boms.length === 0) return { set: 0, converted: 0 };
  const now = nowIso();
  const converted = plan.boms.filter((b) => b.becomesAssembly).length;
  const ops: WriteOp[] = plan.boms.map((b) => ({
    op: "patch",
    collection: "items",
    id: b.assembly.id,
    patch: { bom: b.bom, ...(b.becomesAssembly ? { type: "assembly" } : {}), updatedAt: now, updatedBy: actor.id },
  }));
  const record: BomImportRecord = {
    at: now,
    source: sourceName,
    mode,
    assemblies: plan.boms.map((b) => ({ itemId: b.assembly.id, sku: b.assembly.sku, before: b.assembly.bom, after: b.bom, typeBefore: b.assembly.type, becameAssembly: b.becomesAssembly, summary: entrySummary(b, mode) })),
  };
  const changes = changeLines(plan);
  const activity = activityOp(actor, "import.completed", `${actor.name} imported parts lists for ${plan.boms.length} assembl${plan.boms.length === 1 ? "y" : "ies"} from ${sourceName}${converted ? ` (${converted} made assemblies)` : ""}`, {
    meta: {
      boms: plan.boms.length,
      converted,
      lines: plan.boms.reduce((a, b) => a + b.bom.length, 0),
      skipped: plan.errors.length,
      bomImport: record,
      itemIds: record.assemblies.map((a) => a.itemId),
      perItem: Object.fromEntries(record.assemblies.map((a) => [a.itemId, a.summary])),
      changes,
      changesTotal: changes.length,
    },
  });
  ops.push(activity);
  await store.batch(ops);
  return { set: plan.boms.length, converted, activityId: activity.op === "put" ? (activity.doc as { id: string }).id : undefined };
}

/** The import record on an Activity entry, when it is a BOM import. */
export function bomImportRecord(event: Pick<ActivityEvent, "meta"> | null | undefined): BomImportRecord | null {
  const r = event?.meta?.bomImport as BomImportRecord | undefined;
  return r && Array.isArray(r.assemblies) ? r : null;
}

/** The revert entry for an import, if it has been reverted. */
export function bomImportRevertOf(activity: readonly ActivityEvent[], importId: string): ActivityEvent | undefined {
  return activity.find((a) => a.type === "import.reverted" && a.meta?.revertOf === importId);
}

const sameLines = (a: readonly BomLine[], b: readonly BomLine[]) => {
  const key = (lines: readonly BomLine[]) => JSON.stringify([...lines].map((l) => [l.itemId, round(l.qty, 6)]).sort());
  return key(a) === key(b);
};

/**
 * Put every assembly an import touched back to its list from before the import, and turn parts the
 * import made assemblies back into parts. Refused, with the reason, when it has already been reverted,
 * when one of the assemblies was built after the import, or when a list was edited since.
 */
export async function revertBomImport(store: Store, actor: Actor, importActivityId: string): Promise<{ restored: number }> {
  const [event, activity, items, builds] = await Promise.all([store.get("activity", importActivityId), store.list("activity"), store.list("items"), store.list("builds")]);
  const record = bomImportRecord(event);
  if (!event || !record) throw new InventoryError("That Activity entry is not a parts list import");
  if (bomImportRevertOf(activity, event.id)) throw new InventoryError("This import has already been reverted");
  const byId = new Map(items.map((i) => [i.id, i]));
  const touched = new Set(record.assemblies.map((a) => a.itemId));
  const builtSince = builds.filter((b) => touched.has(b.assemblyId) && (b.completedAt ?? b.createdAt) >= record.at);
  if (builtSince.length) {
    const b = builtSince[0]!;
    throw new InventoryError(`${byId.get(b.assemblyId)?.sku ?? "An assembly"} was built after this import (${b.number}), so the import can't be undone automatically. Change the parts list by hand instead.`);
  }
  for (const a of record.assemblies) {
    const item = byId.get(a.itemId);
    if (!item) throw new InventoryError(`${a.sku} has been deleted since the import, so it can't be reverted`);
    if (!sameLines(item.bom, a.after)) throw new InventoryError(`${a.sku}'s parts list was changed after the import, so reverting would undo that too. Change it by hand instead.`);
  }
  const now = nowIso();
  const ops: WriteOp[] = record.assemblies.map((a) => ({
    op: "patch",
    collection: "items",
    id: a.itemId,
    patch: { bom: a.before, ...(a.becameAssembly ? { type: a.typeBefore } : {}), updatedAt: now, updatedBy: actor.id },
  }));
  const changes = record.assemblies.flatMap((a) => {
    const d = diffBom(a.after, a.before, byId);
    return [
      ...d.changed.map((c) => ({ sku: a.sku, field: `${c.sku} qty`, from: c.from!, to: c.to! })),
      ...d.added.map((c) => ({ sku: a.sku, field: `${c.sku} put back`, from: "", to: c.to! })),
      ...d.removed.map((c) => ({ sku: a.sku, field: `${c.sku} removed`, from: c.from!, to: "" })),
    ];
  });
  const madeParts = record.assemblies.filter((a) => a.becameAssembly).length;
  ops.push(
    activityOp(actor, "import.reverted", `${actor.name} reverted the parts list import from ${record.source}: ${record.assemblies.length} assembl${record.assemblies.length === 1 ? "y" : "ies"} back to their lists from before${madeParts ? `, ${madeParts} back to parts` : ""}`, {
      meta: {
        revertOf: event.id,
        itemIds: record.assemblies.map((a) => a.itemId),
        perItem: Object.fromEntries(record.assemblies.map((a) => [a.itemId, `BOM put back by reverting the import from ${record.source}`])),
        changes,
        changesTotal: changes.length,
      },
    }),
  );
  await store.batch(ops);
  return { restored: record.assemblies.length };
}
