import type { BomLine, BomLineKind, BomSelection, ID, Item } from "@/lib/types";

/**
 * Modular BOMs. An assembly that is 90% fixed and 10% up to the customer keeps
 * ONE bill of materials: most lines are required, some are optional (include it
 * or not), and some are a choice (one of several alternatives that share a
 * group name, such as "Wheel finish").
 *
 * Deciding the open lines gives a plain BOM, which is what building, costing,
 * pick lists and replenishment work from. Where nobody has decided (a forecast,
 * a rolled-up cost), the defaults stand in: each group's default alternative
 * and the optional lines marked as included by default.
 */

export function bomLineKind(line: Pick<BomLine, "kind" | "group">): BomLineKind {
  if (line.kind === "choice" && !line.group?.trim()) return "required";
  return line.kind ?? "required";
}

export function isModularBom(bom: BomLine[]): boolean {
  return bom.some((l) => bomLineKind(l) !== "required");
}

export interface BomChoiceGroup {
  group: string;
  lines: BomLine[];
  /** The alternative used when nobody chooses: the one marked default, else the first. */
  defaultItemId: ID;
}

/** The choices on a BOM, in the order their first line appears. */
export function bomChoiceGroups(bom: BomLine[]): BomChoiceGroup[] {
  const groups = new Map<string, BomLine[]>();
  for (const line of bom) {
    if (bomLineKind(line) !== "choice") continue;
    const key = line.group!.trim();
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  return Array.from(groups, ([group, lines]) => ({ group, lines, defaultItemId: (lines.find((l) => l.isDefault) ?? lines[0]!).itemId }));
}

export function bomOptionalLines(bom: BomLine[]): BomLine[] {
  return bom.filter((l) => bomLineKind(l) === "optional");
}

/** What a build gets when nobody decides anything. */
export function defaultBomSelection(bom: BomLine[]): BomSelection {
  return {
    choices: Object.fromEntries(bomChoiceGroups(bom).map((g) => [g.group, g.defaultItemId])),
    optional: bomOptionalLines(bom).filter((l) => l.isDefault).map((l) => l.itemId),
  };
}

/** A selection with every gap filled from the defaults, so a partial one (only the choices that were changed) is enough. */
export function completeBomSelection(bom: BomLine[], selection?: BomSelection | null): BomSelection {
  const base = defaultBomSelection(bom);
  return { choices: { ...base.choices, ...(selection?.choices ?? {}) }, optional: selection?.optional ?? base.optional };
}

/** Why a selection cannot be built, or null when it can. */
export function bomSelectionError(bom: BomLine[], selection?: BomSelection | null): string | null {
  const sel = completeBomSelection(bom, selection);
  for (const g of bomChoiceGroups(bom)) {
    const chosen = sel.choices?.[g.group];
    if (!chosen) return `Choose a ${g.group}`;
    if (!g.lines.some((l) => l.itemId === chosen)) return `${g.group}: that part is not one of the alternatives`;
  }
  const optional = new Set(bomOptionalLines(bom).map((l) => l.itemId));
  for (const id of sel.optional ?? []) if (!optional.has(id)) return "An optional part was selected that is not on this BOM";
  return null;
}

/** The plain lines that get built for a selection: required lines, the chosen alternative of each group, and the optional lines that were included. */
export function resolveBom(bom: BomLine[], selection?: BomSelection | null): BomLine[] {
  if (!isModularBom(bom)) return bom;
  const sel = completeBomSelection(bom, selection);
  const included = new Set(sel.optional ?? []);
  return bom.filter((line) => {
    const kind = bomLineKind(line);
    if (kind === "optional") return included.has(line.itemId);
    if (kind === "choice") return sel.choices?.[line.group!.trim()] === line.itemId;
    return true;
  });
}

/** One line for a build record or a work order: "Wheel finish: Gloss black · with Spare tire carrier". */
export function describeBomSelection(bom: BomLine[], selection: BomSelection | null | undefined, itemName: (id: ID) => string): string {
  if (!isModularBom(bom)) return "";
  const sel = completeBomSelection(bom, selection);
  const parts = bomChoiceGroups(bom).map((g) => `${g.group}: ${itemName(sel.choices?.[g.group] ?? g.defaultItemId)}`);
  const extras = (sel.optional ?? []).map(itemName);
  if (extras.length) parts.push(`with ${extras.join(", ")}`);
  return parts.join(" · ");
}

/** Whether an assembly has open lines someone must (or may) decide at build time. */
export function hasBomOptions(item: Pick<Item, "bom">): boolean {
  return isModularBom(item.bom);
}
