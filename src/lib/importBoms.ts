/**
 * Parts lists set on the import review step (feature `importEditing`).
 *
 * Rows name their components by SKU because the components may be new in the
 * same file. Once every row has an item, the SKUs are turned into BOM lines;
 * unknown SKUs, an assembly listing itself, and loops are refused per row with
 * a message a person can act on. Plain functions, no React.
 */

import type { BomLine, ID, Item } from "./types";

/** One component of an imported assembly, named by SKU. */
export interface ImportBomLine {
  sku: string;
  qty: number;
}

export interface PendingBom {
  /** Row number reported back in errors. */
  row: number;
  /** The assembly's SKU (upper case). */
  sku: string;
  lines: ImportBomLine[];
}

export interface ResolvedBoms {
  /** Assembly item id → its new BOM. */
  boms: Map<ID, BomLine[]>;
  errors: Array<{ row: number; message: string }>;
}

/** Same SKU twice in one list: one line with the quantities added. Blank SKUs are dropped. */
export function mergeBomLines(lines: ImportBomLine[]): ImportBomLine[] {
  const out = new Map<string, ImportBomLine>();
  for (const l of lines) {
    const sku = l.sku.trim().toUpperCase();
    if (!sku) continue;
    const prev = out.get(sku);
    out.set(sku, { sku, qty: (prev?.qty ?? 0) + l.qty });
  }
  return [...out.values()];
}

/** Why a parts list cannot be used as it stands, judged against the SKUs that will exist; null when it is fine. */
export function bomLinesProblem(assemblySku: string, lines: ImportBomLine[], knownSkus: ReadonlySet<string>): string | null {
  const self = assemblySku.trim().toUpperCase();
  for (const l of mergeBomLines(lines)) {
    if (l.sku === self) return `Parts list: ${l.sku} cannot be a component of itself`;
    if (!knownSkus.has(l.sku)) return `Parts list: ${l.sku} is not in the file or in inventory`;
    if (!Number.isFinite(l.qty) || l.qty <= 0) return `Parts list: quantity for ${l.sku} must be more than zero`;
  }
  return null;
}

/**
 * Turn pending parts lists into BOM lines. `bySku` holds every item that will exist after the import (upper-case
 * SKU keys), existing and new. Lines already on an existing BOM keep their waste, role and note.
 */
export function resolveImportBoms(pending: PendingBom[], bySku: ReadonlyMap<string, Item>): ResolvedBoms {
  const known = new Set(bySku.keys());
  const errors: ResolvedBoms["errors"] = [];
  const candidates = new Map<ID, { row: number; sku: string; bom: BomLine[] }>();

  for (const p of pending) {
    const assembly = bySku.get(p.sku);
    if (!assembly) continue;
    const problem = bomLinesProblem(p.sku, p.lines, known);
    if (problem) {
      errors.push({ row: p.row, message: `${p.sku}: ${problem}` });
      continue;
    }
    const before = new Map(assembly.bom.map((l) => [l.itemId, l]));
    const bom = mergeBomLines(p.lines).map((l) => {
      const itemId = bySku.get(l.sku)!.id;
      return { ...(before.get(itemId) ?? {}), itemId, qty: l.qty };
    });
    candidates.set(assembly.id, { row: p.row, sku: p.sku, bom });
  }

  // Refuse lists that would make a loop (A uses B, B uses A), judged with the other new lists in place.
  const byId = new Map([...bySku.values()].map((i) => [i.id, i]));
  const componentsOf = (id: ID): ID[] => (candidates.get(id)?.bom ?? byId.get(id)?.bom ?? []).map((l) => l.itemId);
  for (;;) {
    const looping = [...candidates.keys()].find((start) => {
      const seen = new Set<ID>();
      const stack = [...componentsOf(start)];
      while (stack.length) {
        const id = stack.pop()!;
        if (id === start) return true;
        if (seen.has(id)) continue;
        seen.add(id);
        stack.push(...componentsOf(id));
      }
      return false;
    });
    if (!looping) break;
    const c = candidates.get(looping)!;
    errors.push({ row: c.row, message: `${c.sku}: Parts list would make a loop (an assembly that ends up inside itself)` });
    candidates.delete(looping);
  }

  return { boms: new Map([...candidates].map(([id, c]) => [id, c.bom])), errors };
}
