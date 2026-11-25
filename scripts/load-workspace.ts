/**
 * Operator tool: clear a workspace and load items and parts lists from
 * spreadsheets, as Settings → Data → Clear workspace followed by Import → Items
 * would, in one go and without the browser. Run from the repo root with the
 * service account in .env.local (FIREBASE_SERVICE_ACCOUNT_JSON):
 *
 *   npx tsx scripts/load-workspace.ts "Company name" ~/Downloads          dry run: reads the files, shows the plan
 *   npx tsx scripts/load-workspace.ts "Company name" ~/Downloads --yes    clears the workspace, then loads
 *   npx tsx scripts/load-workspace.ts "Company name" a.xlsx b.csv --keep --yes   load into what is there
 *
 * Files: every .xlsx, .xls or .csv named; a folder is scanned (not recursively)
 * in name order, and later files override earlier ones for the same part number.
 * - An item sheet has a part number column (Part number, SKU, Item number) and a
 *   name column (Title, Name). Also read when present: Product group / Category,
 *   UoM / Unit, Min. stock, Selling price / Price, Cost per unit / Cost, Quantity
 *   at stock / On hand, Is procured article (0 = made here), Vendor / Supplier,
 *   Lead time (days). Negative stock becomes 0: the ledger never goes below zero.
 * - A parts-list sheet has Assembly, Component and Quantity columns. Both are
 *   matched by part number, then by name; one that is in no item sheet is created
 *   with a part number made from its name.
 * The team and the settings survive the clear; demo people (u_…) and guests do not.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { getFirestore } from "firebase-admin/firestore";
import * as XLSX from "xlsx";
import { AdminFirestoreStore, adminApp, readServiceAccount } from "../src/lib/mcp/adminStore";
import { importItems, type ImportResult, type ImportRow } from "../src/lib/inventory";
import type { ImportBomLine } from "../src/lib/importBoms";
import { freshWorkspace } from "../src/lib/seed";
import type { Store, StoreKind, WriteOp } from "../src/lib/store/types";
import { COLLECTIONS, type CollectionMap, type CollectionName, type Member, type WorkspaceSnapshot } from "../src/lib/types";

const USAGE = `Usage: npx tsx scripts/load-workspace.ts "<workspace name or id>" <file or folder>... [--yes] [--keep]
  --yes   write to the workspace (without it: dry run against an empty copy)
  --keep  do not clear the workspace first; update what is there by part number`;

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function loadEnvFile(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || process.env[m[1]!] !== undefined) continue;
    process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

// ---- arguments ---------------------------------------------------------------

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const [target, ...paths] = argv.filter((a) => !a.startsWith("--"));
if (!target || paths.length === 0) {
  console.error(USAGE);
  process.exit(2);
}
for (const f of flags) if (f !== "--yes" && f !== "--keep") fail(`Unknown option ${f}\n${USAGE}`);
const apply = flags.includes("--yes");
const keep = flags.includes("--keep");

// ---- reading the sheets ------------------------------------------------------

type Cell = string | number | boolean | null;
interface Sheet {
  file: string;
  name: string;
  rows: Cell[][];
}

const SHEET_EXT = new Set([".xlsx", ".xls", ".csv"]);

function listFiles(args: string[]): string[] {
  const out: string[] = [];
  for (const p of args) {
    const full = resolve(p);
    if (!existsSync(full)) fail(`${p} does not exist`);
    if (statSync(full).isDirectory()) {
      const names = readdirSync(full)
        .filter((n) => SHEET_EXT.has(extname(n).toLowerCase()) && !n.startsWith("~$") && !n.startsWith("."))
        .sort((a, b) => a.localeCompare(b));
      if (names.length === 0) fail(`${p} has no .xlsx or .csv files`);
      out.push(...names.map((n) => join(full, n)));
    } else {
      if (!SHEET_EXT.has(extname(full).toLowerCase())) fail(`${p}: only .xlsx, .xls and .csv files are read`);
      out.push(full);
    }
  }
  return out;
}

function readSheets(path: string): Sheet[] {
  const wb = XLSX.readFile(path);
  return wb.SheetNames.map((name) => ({
    file: basename(path),
    name,
    rows: XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name]!, { header: 1, blankrows: false, defval: "" }),
  }));
}

const text = (v: Cell | undefined) => String(v ?? "").trim();
const norm = (v: Cell | undefined) => text(v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function num(v: Cell | undefined): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  const s = text(v).replace(/[,$\s]/g, "");
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}
function column(headers: string[], aliases: string[]): number {
  for (const a of aliases) {
    const i = headers.indexOf(a);
    if (i >= 0) return i;
  }
  return -1;
}

const ITEM = {
  sku: ["part number", "part no", "part num", "sku", "item number", "item code", "item no", "code"],
  name: ["title", "name", "item name", "product name", "description"],
  category: ["product group", "category", "product category", "group"],
  unit: ["uom", "unit", "unit of measure", "units"],
  minQty: ["min stock", "minimum stock", "min qty", "reorder point", "minimum", "min"],
  price: ["selling price", "price", "list price", "retail price"],
  unitCost: ["cost per unit", "unit cost", "cost", "standard cost", "average cost"],
  qty: ["quantity at stock", "quantity on hand", "on hand", "quantity", "qty", "in stock", "stock"],
  procured: ["is procured article", "procured", "is purchased", "purchased"],
  supplier: ["vendor", "supplier", "preferred vendor", "preferred supplier"],
  leadTime: ["lead time days", "lead time", "lead time in days"],
};
const BOM = {
  assembly: ["assembly", "parent", "parent sku", "parent part", "finished good", "bom"],
  component: ["component", "component sku", "child", "material", "part"],
  qty: ["quantity", "qty", "qty per", "quantity per", "per"],
};
/** The app stocks by the each; these spellings all mean that. */
const UNIT: Record<string, string> = { pcs: "ea", pc: "ea", piece: "ea", pieces: "ea", each: "ea", ea: "ea", unit: "ea", units: "ea" };

interface Draft {
  sku: string;
  name?: string;
  category?: string;
  unit?: string;
  minQty?: number;
  price?: number;
  unitCost?: number;
  qty?: number;
  /** Made here (Is procured article = 0) rather than bought. */
  made?: boolean;
  supplier?: string;
  leadTimeDays?: number;
  bom?: ImportBomLine[];
}
interface BomDraft {
  assembly: string;
  component: string;
  qty: number;
  where: string;
}

const drafts = new Map<string, Draft>();
const skuByName = new Map<string, string>();
const bomDrafts: BomDraft[] = [];
const notes: string[] = [];

function readItemSheet(sheet: Sheet, headers: string[]) {
  const col = Object.fromEntries(Object.entries(ITEM).map(([k, aliases]) => [k, column(headers, aliases)])) as Record<keyof typeof ITEM, number>;
  let count = 0;
  sheet.rows.slice(1).forEach((row, i) => {
    const sku = text(row[col.sku]).toUpperCase();
    if (!sku) return;
    const d = drafts.get(sku) ?? { sku };
    const name = text(row[col.name]);
    if (name) d.name = name;
    const category = col.category >= 0 ? text(row[col.category]) : "";
    if (category) d.category = category;
    const unit = col.unit >= 0 ? text(row[col.unit]).toLowerCase() : "";
    if (unit) d.unit = UNIT[unit] ?? unit;
    const supplier = col.supplier >= 0 ? text(row[col.supplier]) : "";
    if (supplier) d.supplier = supplier;
    for (const [key, idx] of [["minQty", col.minQty], ["price", col.price], ["unitCost", col.unitCost], ["qty", col.qty], ["leadTimeDays", col.leadTime]] as const) {
      if (idx < 0) continue;
      const n = num(row[idx]);
      if (n !== undefined) d[key] = n;
    }
    if (col.procured >= 0) {
      const p = text(row[col.procured]).toLowerCase();
      if (["0", "false", "no", "n"].includes(p)) d.made = true;
      else if (["1", "true", "yes", "y"].includes(p)) d.made = false;
    }
    if (!d.name) notes.push(`${sheet.file} row ${i + 2}: ${sku} has no name; it is created only if another file names it`);
    drafts.set(sku, d);
    if (d.name) skuByName.set(norm(d.name), sku);
    count++;
  });
  return count;
}

function readBomSheet(sheet: Sheet, headers: string[]) {
  const a = column(headers, BOM.assembly);
  const c = column(headers, BOM.component);
  const q = column(headers, BOM.qty);
  let count = 0;
  sheet.rows.slice(1).forEach((row, i) => {
    const assembly = text(row[a]);
    const component = text(row[c]);
    if (!assembly || !component) return;
    const qty = q >= 0 ? num(row[q]) : 1;
    if (qty === undefined || qty <= 0) {
      notes.push(`${sheet.file} row ${i + 2}: no usable quantity for ${component} in ${assembly}; line skipped`);
      return;
    }
    bomDrafts.push({ assembly, component, qty, where: `${sheet.file} row ${i + 2}` });
    count++;
  });
  return count;
}

const files = listFiles(paths);
console.log(`Reading ${files.length} file${files.length === 1 ? "" : "s"}:`);
for (const path of files) {
  for (const sheet of readSheets(path)) {
    const headers = (sheet.rows[0] ?? []).map((h) => norm(h));
    const label = `${sheet.file}${sheet.name === "Sheet1" ? "" : ` › ${sheet.name}`}`;
    if (column(headers, BOM.assembly) >= 0 && column(headers, BOM.component) >= 0) {
      console.log(`  ✓ ${label}: ${readBomSheet(sheet, headers)} parts-list lines`);
    } else if (column(headers, ITEM.sku) >= 0 && column(headers, ITEM.name) >= 0) {
      console.log(`  ✓ ${label}: ${readItemSheet(sheet, headers)} item rows`);
    } else {
      console.log(`  – ${label}: skipped (no part number and name columns, and no Assembly and Component columns)`);
    }
  }
}

// ---- parts lists -------------------------------------------------------------

const invented: Array<{ sku: string; name: string; as: "part" | "assembly" }> = [];

function skuFor(ref: string): string | undefined {
  const up = ref.trim().toUpperCase();
  if (drafts.has(up)) return up;
  return skuByName.get(norm(ref));
}

function skuFromName(name: string): string {
  const base = name.toUpperCase().replace(/["'“”’]/g, "").replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "") || "ITEM";
  let sku = base;
  for (let n = 2; drafts.has(sku); n++) sku = `${base}-${n}`;
  return sku;
}

function ensure(ref: string, as: "part" | "assembly"): string {
  const found = skuFor(ref);
  if (found) return found;
  const sku = skuFromName(ref);
  drafts.set(sku, { sku, name: ref.trim(), made: as === "assembly" });
  skuByName.set(norm(ref), sku);
  invented.push({ sku, name: ref.trim(), as });
  return sku;
}

for (const b of bomDrafts) {
  const assembly = ensure(b.assembly, "assembly");
  const component = ensure(b.component, "part");
  if (assembly === component) {
    notes.push(`${b.where}: ${b.assembly} lists itself as a component; line skipped`);
    continue;
  }
  const d = drafts.get(assembly)!;
  d.made = true;
  (d.bom ??= []).push({ sku: component, qty: b.qty });
}

// ---- rows for the importer ---------------------------------------------------

const negatives: string[] = [];
const rows: ImportRow[] = [];
for (const d of drafts.values()) {
  if (!d.name) continue;
  let qty = d.qty;
  if (qty !== undefined && qty < 0) {
    negatives.push(`${d.sku} ${d.name} (${qty})`);
    qty = 0;
  }
  rows.push({
    sku: d.sku,
    name: d.name,
    category: d.category,
    unit: d.unit,
    qty,
    unitCost: d.unitCost,
    price: d.price,
    minQty: d.minQty !== undefined && d.minQty > 0 ? d.minQty : undefined,
    leadTimeDays: d.leadTimeDays,
    // The vendor column of something made here names the company itself.
    supplierName: d.made ? undefined : d.supplier,
    type: d.made ? "assembly" : undefined,
    bom: d.bom,
  });
}
const assemblies = rows.filter((r) => r.bom?.length).length;

console.log(`\n${rows.length} items to load, ${assemblies} with parts lists.`);
if (invented.length) {
  console.log(`${invented.length} named only in a parts list, created with a part number made from the name (rename later):`);
  for (const i of invented) console.log(`  + ${i.sku}  ${i.name}  (${i.as})`);
}
if (negatives.length) {
  console.log(`${negatives.length} with negative stock in the file, loaded as 0:`);
  for (const n of negatives) console.log(`  · ${n}`);
}
for (const n of notes) console.log(`  ! ${n}`);
if (rows.length === 0) fail("Nothing to load.");

// ---- stores ------------------------------------------------------------------

/** In-memory Store for the dry run: the importer runs for real, nothing is written anywhere. */
class MemoryStore implements Store {
  readonly kind: StoreKind = "local";
  private data = new Map<CollectionName, Map<string, { id: string }>>();
  constructor(snapshot: WorkspaceSnapshot) {
    void this.replaceAll(snapshot);
  }
  private col(name: CollectionName) {
    return this.data.get(name)!;
  }
  private merge(current: { id: string }, patch: Record<string, unknown>): { id: string } {
    const next: Record<string, unknown> = { ...current };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = structuredClone(v);
    }
    return next as { id: string };
  }
  async ready() {}
  peek<C extends CollectionName>(name: C): CollectionMap[C][] {
    return [...this.col(name).values()] as CollectionMap[C][];
  }
  async list<C extends CollectionName>(name: C): Promise<CollectionMap[C][]> {
    return this.peek(name);
  }
  async get<C extends CollectionName>(name: C, id: string): Promise<CollectionMap[C] | null> {
    return (this.col(name).get(id) as CollectionMap[C] | undefined) ?? null;
  }
  subscribe<C extends CollectionName>(name: C, listener: (rows: CollectionMap[C][]) => void) {
    listener(this.peek(name));
    return () => {};
  }
  async put<C extends CollectionName>(name: C, doc: CollectionMap[C]) {
    this.col(name).set(doc.id, structuredClone(doc));
  }
  async patch<C extends CollectionName>(name: C, id: string, patch: Partial<CollectionMap[C]>) {
    const current = this.col(name).get(id);
    if (current) this.col(name).set(id, this.merge(current, patch as Record<string, unknown>));
  }
  async remove<C extends CollectionName>(name: C, id: string) {
    this.col(name).delete(id);
  }
  async batch(ops: WriteOp[]) {
    for (const op of ops) {
      const col = this.col(op.collection);
      if (op.op === "put") col.set(op.doc.id, structuredClone(op.doc));
      else if (op.op === "remove") col.delete(op.id);
      else {
        const current = col.get(op.id);
        if (current) col.set(op.id, this.merge(current, op.patch as Record<string, unknown>));
      }
    }
  }
  async replaceAll(snapshot: WorkspaceSnapshot) {
    for (const name of COLLECTIONS) this.data.set(name, new Map((snapshot[name] as Array<{ id: string }>).map((r) => [r.id, structuredClone(r)])));
  }
  async snapshot(): Promise<WorkspaceSnapshot> {
    const out = {} as Record<CollectionName, unknown[]>;
    for (const name of COLLECTIONS) out[name] = this.peek(name);
    return out as WorkspaceSnapshot;
  }
}

/** Same as the admin dashboard's Clear workspace: an empty workspace that keeps the real team and the settings. */
function cleared(current: WorkspaceSnapshot): WorkspaceSnapshot {
  const team = current.members.filter((m) => !m.id.startsWith("u_") && !m.guest);
  const settings = current.settings[0];
  const next = freshWorkspace({ members: team, companyName: settings?.companyName, currency: settings?.currency });
  if (settings) next.settings = [{ ...next.settings[0]!, ...settings, automations: next.settings[0]!.automations }];
  return next;
}

function actorFrom(members: Member[]) {
  const owner = members.find((m) => m.role === "owner" && !m.id.startsWith("u_") && !m.guest) ?? members.find((m) => !m.id.startsWith("u_") && !m.guest);
  return owner ? { id: owner.id, name: owner.name } : { id: "load-workspace", name: "Loader script" };
}

async function openWorkspace() {
  loadEnvFile(".env.local");
  const sa = readServiceAccount();
  if (!sa) fail("No service account: put FIREBASE_SERVICE_ACCOUNT_JSON in .env.local (the same value Vercel has).");
  const db = getFirestore(adminApp(sa));
  let id: string;
  let name: string;
  const direct = /^[A-Za-z0-9_-]{1,128}$/.test(target) ? await db.doc(`workspaces/${target}`).get() : null;
  if (direct?.exists) {
    id = direct.id;
    name = String(direct.data()?.name ?? target);
  } else {
    const all = await db.collection("workspaces").get();
    const wanted = target.trim().toLowerCase();
    const matches = all.docs.filter((d) => String(d.data().name ?? "").trim().toLowerCase() === wanted);
    if (matches.length === 0) fail(`No workspace is named "${target}". Workspaces: ${all.docs.map((d) => `"${String(d.data().name ?? d.id)}"`).join(", ")}`);
    if (matches.length > 1) fail(`${matches.length} workspaces are named "${target}" (${matches.map((d) => d.id).join(", ")}); pass the id instead.`);
    id = matches[0]!.id;
    name = String(matches[0]!.data().name);
  }
  return { db, id, name, store: new AdminFirestoreStore(sa, id) };
}

function printResult(result: ImportResult) {
  console.log(`✓ ${result.created} created, ${result.updated} updated, ${result.skipped} skipped; parts lists set on ${result.bomsSet ?? 0}.`);
  for (const e of result.errors) console.log(`  ✗ row ${e.row}: ${e.message}`);
}

async function printItems(store: Store) {
  const items = await store.list("items");
  const suppliers = new Map((await store.list("suppliers")).map((s) => [s.id, s.name]));
  console.log(["SKU", "Name", "Type", "On hand", "Cost", "Price", "Parts", "Supplier"].join("\t"));
  for (const i of [...items].sort((a, b) => a.sku.localeCompare(b.sku, undefined, { numeric: true }))) {
    console.log([i.sku, i.name, i.type, i.onHand, i.unitCost, i.price, i.bom?.length ?? "", i.supplierId ? (suppliers.get(i.supplierId) ?? "") : ""].join("\t"));
  }
}

async function main() {
  if (!apply) {
    console.log(`\nDry run against an empty copy of "${target}" (add --yes to write):`);
    const store = new MemoryStore(freshWorkspace({ companyName: target, currency: "USD" }));
    printResult(await importItems(store, { id: "dry-run", name: "Dry run" }, rows, { setQuantities: true }));
    await printItems(store);
    return;
  }
  const { db, id, name, store } = await openWorkspace();
  const current = await store.snapshot();
  console.log(`\nWorkspace "${name}" (${id}) today: ${current.items.length} items, ${current.orders.length} orders, ${current.members.length} members.`);
  if (!keep) {
    await store.replaceAll(cleared(current));
    console.log("✓ Cleared; the team and the settings were kept.");
  }
  const actor = actorFrom(current.members);
  const result = await importItems(store, actor, rows, { setQuantities: true });
  printResult(result);
  await printItems(store);
  const at = new Date().toISOString();
  await db.doc(`adminActions/${at}-${id}`).set({ action: keep ? "workspace.load" : "workspace.clear-and-load", actor: "scripts/load-workspace.ts", target: id, summary: `${result.created} created, ${result.updated} updated from ${files.map((f) => basename(f)).join(", ")}`, at });
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
