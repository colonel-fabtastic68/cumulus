import type { EnteredQty, Item, UnitConversion } from "@/lib/types";
import { round } from "@/lib/utils";

/**
 * Units of measure. Stock is always counted in the item's own unit (`item.unit`,
 * the stocking unit). An item can also be bought or sold in other units:
 *
 * - its own conversions (`item.uoms`): a case of 12, a pack of 100, a 500 ft spool;
 * - standard units of the same kind as the stocking unit: an item stocked in
 *   gallons can be sold by the pint or the quart with no setup.
 *
 * Documents keep `qty` in the stocking unit and remember what was typed in
 * `entered` ({ qty: 2, unit: "case" }), so every report, forecast and ledger
 * entry stays in one unit and prints can still say "2 case".
 */

export type UnitKind = "volume" | "length" | "weight" | "count";

interface StandardUnit {
  kind: UnitKind;
  /** Size in the kind's base unit (ml, mm, g, each). */
  base: number;
  label: string;
  aliases: string[];
}

const STANDARD: Record<string, StandardUnit> = {
  // Volume, US customary, in milliliters.
  gal: { kind: "volume", base: 3785.411784, label: "Gallon", aliases: ["gallon", "gallons", "gal."] },
  qt: { kind: "volume", base: 946.352946, label: "Quart", aliases: ["quart", "quarts"] },
  pt: { kind: "volume", base: 473.176473, label: "Pint", aliases: ["pint", "pints"] },
  cup: { kind: "volume", base: 236.5882365, label: "Cup", aliases: ["cups"] },
  floz: { kind: "volume", base: 29.5735295625, label: "Fluid ounce", aliases: ["fl oz", "fl. oz.", "fluid ounce", "fluid ounces"] },
  l: { kind: "volume", base: 1000, label: "Liter", aliases: ["liter", "liters", "litre", "litres"] },
  ml: { kind: "volume", base: 1, label: "Milliliter", aliases: ["milliliter", "milliliters"] },
  // Length, in millimeters.
  ft: { kind: "length", base: 304.8, label: "Foot", aliases: ["foot", "feet", "ft."] },
  in: { kind: "length", base: 25.4, label: "Inch", aliases: ["inch", "inches", "in."] },
  yd: { kind: "length", base: 914.4, label: "Yard", aliases: ["yard", "yards"] },
  m: { kind: "length", base: 1000, label: "Meter", aliases: ["meter", "meters", "metre", "metres"] },
  cm: { kind: "length", base: 10, label: "Centimeter", aliases: ["centimeter", "centimeters"] },
  mm: { kind: "length", base: 1, label: "Millimeter", aliases: ["millimeter", "millimeters"] },
  // Weight, in grams.
  lb: { kind: "weight", base: 453.59237, label: "Pound", aliases: ["lbs", "pound", "pounds", "lb."] },
  oz: { kind: "weight", base: 28.349523125, label: "Ounce", aliases: ["ounce", "ounces", "oz."] },
  kg: { kind: "weight", base: 1000, label: "Kilogram", aliases: ["kilogram", "kilograms", "kilo", "kilos"] },
  g: { kind: "weight", base: 1, label: "Gram", aliases: ["gram", "grams"] },
  // Count.
  ea: { kind: "count", base: 1, label: "Each", aliases: ["each", "pc", "pcs", "piece", "pieces", "unit", "units"] },
  pr: { kind: "count", base: 2, label: "Pair", aliases: ["pair", "pairs"] },
  dz: { kind: "count", base: 12, label: "Dozen", aliases: ["dozen", "doz"] },
};

const ALIASES = new Map<string, string>(Object.entries(STANDARD).flatMap(([code, u]) => [[code, code], ...u.aliases.map((a) => [a, code] as [string, string])]));

/** The standard code for a unit as typed ("Gallons" → "gal"), or the trimmed lower-case text when it is not a standard unit. */
export function normalizeUnit(unit: string | undefined | null): string {
  const u = (unit ?? "").trim().toLowerCase();
  return ALIASES.get(u) ?? u;
}

export function unitKind(unit: string | undefined | null): UnitKind | null {
  return STANDARD[normalizeUnit(unit)]?.kind ?? null;
}

/** Convert between two standard units of the same kind; null when they are not comparable (ft to lb, or a unit we do not know). */
export function convertStandard(qty: number, from: string, to: string): number | null {
  const a = STANDARD[normalizeUnit(from)];
  const b = STANDARD[normalizeUnit(to)];
  if (!a || !b || a.kind !== b.kind) return null;
  return (qty * a.base) / b.base;
}

/** A pack unit for a count: packUnit(100) → { unit: "pk100", factor: 100, label: "Pack of 100" }. */
export function packUnit(count: number, word: "pk" | "case" | "box" = "pk"): UnitConversion {
  const name = word === "pk" ? "Pack" : word === "case" ? "Case" : "Box";
  return { unit: `${word}${count}`, factor: count, label: `${name} of ${count}` };
}

/** Reads "Pk 100", "case of 12", "box/50" into a pack unit; null when the text is not one. */
export function parsePackUnit(text: string): UnitConversion | null {
  const m = /^(pk|pack|case|cs|box|bx)\s*(?:of|\/|x|-)?\s*(\d+(?:\.\d+)?)$/i.exec(text.trim());
  if (!m) return null;
  const word = /^(case|cs)$/i.test(m[1]!) ? "case" : /^(box|bx)$/i.test(m[1]!) ? "box" : "pk";
  const n = Number(m[2]);
  return n > 0 ? packUnit(n, word) : null;
}

export interface UnitOption extends UnitConversion {
  /** own = defined on the item; standard = derived from the stocking unit's kind; stock = the stocking unit itself. */
  source: "stock" | "own" | "standard";
}

/** Every unit an item can be entered in: its stocking unit, its own conversions, then standard units of the same kind. */
export function unitOptions(item: Pick<Item, "unit" | "uoms">): UnitOption[] {
  const stock = normalizeUnit(item.unit) || "ea";
  const out: UnitOption[] = [{ unit: item.unit || "ea", factor: 1, label: STANDARD[stock]?.label, source: "stock" }];
  const seen = new Set([stock]);
  for (const u of item.uoms ?? []) {
    const code = normalizeUnit(u.unit);
    if (!code || seen.has(code) || !(u.factor > 0)) continue;
    seen.add(code);
    out.push({ ...u, source: "own" });
  }
  const kind = STANDARD[stock]?.kind;
  // Count units (pair, dozen) are only offered when the item defines them: "dozen" of a part is rarely meant.
  if (kind && kind !== "count") {
    for (const [code, u] of Object.entries(STANDARD)) {
      if (u.kind !== kind || seen.has(code)) continue;
      seen.add(code);
      out.push({ unit: code, factor: u.base / STANDARD[stock]!.base, label: u.label, source: "standard" });
    }
  }
  return out;
}

/** How many stocking units one `unit` of this item is; null when the item cannot be measured in it. */
export function unitFactor(item: Pick<Item, "unit" | "uoms">, unit: string | undefined | null): number | null {
  const code = normalizeUnit(unit);
  if (!code || code === normalizeUnit(item.unit)) return 1;
  return unitOptions(item).find((o) => normalizeUnit(o.unit) === code)?.factor ?? null;
}

/** A quantity in one of the item's units, as stocking units. Throws when the unit does not apply to the item. */
export function toStockQty(item: Pick<Item, "sku" | "unit" | "uoms">, qty: number, unit?: string | null): number {
  const f = unitFactor(item, unit);
  if (f === null) throw new Error(`${item.sku} is not measured in ${unit}`);
  return round(qty * f, 4);
}

/** A stocking quantity expressed in another of the item's units. */
export function fromStockQty(item: Pick<Item, "sku" | "unit" | "uoms">, stockQty: number, unit?: string | null): number {
  const f = unitFactor(item, unit);
  if (f === null) throw new Error(`${item.sku} is not measured in ${unit}`);
  return round(stockQty / f, 4);
}

/** A price or cost per stocking unit, per one of the item's other units (a case of 12 costs 12 × the each cost). */
export function pricePer(item: Pick<Item, "sku" | "unit" | "uoms">, perStockUnit: number, unit?: string | null): number {
  const f = unitFactor(item, unit);
  if (f === null) throw new Error(`${item.sku} is not measured in ${unit}`);
  return round(perStockUnit * f, 4);
}

/** The `entered` record for a line typed in another unit; undefined when it was typed in the stocking unit. */
export function enteredFor(item: Pick<Item, "unit">, qty: number, unit?: string | null): EnteredQty | undefined {
  const code = normalizeUnit(unit);
  return !code || code === normalizeUnit(item.unit) ? undefined : { qty, unit: unit!.trim() };
}

export function unitLabel(unit: string): string {
  return STANDARD[normalizeUnit(unit)]?.label ?? unit;
}

/** "2 case (24 ea)" for a line entered in another unit, else the plain stocking quantity. */
export function describeQty(item: Pick<Item, "unit">, stockQty: number, entered?: EnteredQty): string {
  const plain = `${trim(stockQty)}${item.unit && item.unit !== "ea" ? ` ${item.unit}` : ""}`;
  return entered ? `${trim(entered.qty)} ${entered.unit} (${trim(stockQty)} ${item.unit || "ea"})` : plain;
}

function trim(n: number): string {
  return String(round(n, 3));
}
