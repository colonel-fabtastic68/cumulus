import type { Item, Lot } from "@/lib/types";

/**
 * Plans how cumulusOS follows Square on a ranch instance, without touching
 * either side (the bridge applies the plan). Square stays the record of what
 * is in the freezer, per animal:
 *
 *   Square item "Ribeye Steak" (sold by the pound)   → cumulusOS item, unit lb
 *   its variation "1975 - 27F - PURE" (Lot # option)  → a lot on that item
 *   the variation's in-stock count                    → the lot's quantity
 *
 * Square lets counts go below zero; cumulusOS cannot, so those lots are held
 * at zero and reported. Web sales the bridge has taken off a lot but not yet
 * pushed to Square are passed in as `pending`, so the mirror does not put them
 * back while the push is outstanding.
 */

export type MirrorUnit = "lb" | "oz" | "kg" | "g" | "ea";

/** One Square variation, flattened from the catalog. */
export interface SquareCatalogRow {
  squareItemId: string;
  itemName: string;
  variationId: string;
  variationName: string;
  sku?: string;
  /** Price per unit in cents; absent for variable-priced variations. */
  priceCents?: number;
  unit: MirrorUnit;
  /** When the variation was created in Square: the age that decides oldest-first selling. */
  createdAt?: string;
  trackInventory: boolean;
}

export interface MirrorInput {
  rows: SquareCatalogRow[];
  /** In-stock count per variation (absent means zero). */
  counts: Map<string, number>;
  items: Item[];
  lots: Lot[];
  /** Per variation: pounds cumulusOS has already taken that Square has not been told about yet (negative for returns). */
  pending?: Map<string, number>;
  /** SKUs of items the workspace deleted: their Square items are not brought back. */
  excludedSkus?: Set<string>;
  /** Only look at these variations (a webhook naming a few counts); new items and lots are still created for them. */
  onlyVariationIds?: Set<string>;
  now: string;
}

export interface MirrorPlan {
  newItems: Array<{ squareItemId: string; sku: string; name: string; unit: MirrorUnit; price: number }>;
  /** Existing items linked by SKU for the first time, or renamed/repriced in Square. */
  itemPatches: Array<{ itemId: string; patch: Partial<Pick<Item, "name" | "price" | "unit" | "externalIds">> }>;
  /** Lots to create. `itemId` is absent when the item is new in this plan (look it up by `squareItemId`). */
  newLots: Array<{ squareItemId: string; itemId?: string; variationId: string; label: string; qty: number; receivedAt: string }>;
  /** Quantity changes on existing lots. */
  changes: Array<{ itemId: string; lotId: string; variationId: string; label: string; from: number; to: number }>;
  /** Square counts below zero, held at zero here. */
  negatives: Array<{ itemName: string; label: string; qty: number }>;
  /** Square items left out: not sold by weight, inventory not tracked, or deleted here. */
  skippedItems: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** cumulusOS SKU for a Square item: its name as an upper-case slug ("Ribeye Steak" → RIBEYE-STEAK). */
export function skuForSquareItem(name: string): string {
  const slug = name
    .toUpperCase()
    .replace(/%/g, "-")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "SQUARE-ITEM";
}

/** Square measurement units to cumulusOS unit labels. Anything not by weight sells by the each. */
export function unitForSquare(weightUnit: string | undefined): MirrorUnit {
  switch (weightUnit) {
    case "IMPERIAL_POUND":
      return "lb";
    case "IMPERIAL_WEIGHT_OUNCE":
      return "oz";
    case "METRIC_KILOGRAM":
      return "kg";
    case "METRIC_GRAM":
      return "g";
    default:
      return "ea";
  }
}

function mostCommon<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | undefined;
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

export function planMirror(input: MirrorInput): MirrorPlan {
  const plan: MirrorPlan = { newItems: [], itemPatches: [], newLots: [], changes: [], negatives: [], skippedItems: 0 };
  const bySquareItem = new Map<string, SquareCatalogRow[]>();
  for (const r of input.rows) bySquareItem.set(r.squareItemId, [...(bySquareItem.get(r.squareItemId) ?? []), r]);
  const itemBySquare = new Map(input.items.filter((i) => i.externalIds?.square).map((i) => [i.externalIds!.square!, i]));
  const itemBySku = new Map(input.items.map((i) => [i.sku.toUpperCase(), i]));
  const lotByVariation = new Map(input.lots.filter((l) => l.externalIds?.square).map((l) => [l.externalIds!.square!, l]));
  const takenSkus = new Set(input.items.map((i) => i.sku.toUpperCase()));
  const pending = input.pending ?? new Map<string, number>();

  for (const [squareItemId, rows] of bySquareItem) {
    const unit = mostCommon(rows.map((r) => r.unit)) ?? "ea";
    const tracked = rows.filter((r) => r.trackInventory);
    if (unit === "ea" || tracked.length === 0) {
      plan.skippedItems++;
      continue;
    }
    const relevant = input.onlyVariationIds ? tracked.filter((r) => input.onlyVariationIds!.has(r.variationId)) : tracked;
    if (relevant.length === 0) continue;
    const name = rows[0]!.itemName.trim();
    const cents = mostCommon(tracked.map((r) => r.priceCents).filter((c): c is number => typeof c === "number"));
    const price = cents !== undefined ? Math.round(cents) / 100 : 0;

    let item = itemBySquare.get(squareItemId);
    let itemId = item?.id;
    if (!item) {
      const sku = skuForSquareItem(name);
      if (input.excludedSkus?.has(sku)) {
        plan.skippedItems++;
        continue;
      }
      const adopt = itemBySku.get(sku);
      if (adopt && !adopt.externalIds?.square) {
        // An item already here under the same SKU becomes the cut (e.g. created by hand before Square was connected).
        item = adopt;
        itemId = adopt.id;
        plan.itemPatches.push({ itemId: adopt.id, patch: { externalIds: { ...(adopt.externalIds ?? {}), square: squareItemId }, unit, ...(price > 0 && adopt.price !== price ? { price } : {}) } });
      } else {
        let unique = sku;
        for (let n = 2; takenSkus.has(unique.toUpperCase()); n++) unique = `${sku.slice(0, 36)}-${n}`;
        takenSkus.add(unique);
        plan.newItems.push({ squareItemId, sku: unique, name, unit, price });
      }
    } else {
      const patch: Partial<Pick<Item, "name" | "price" | "unit">> = {};
      if (item.name !== name) patch.name = name;
      if (price > 0 && item.price !== price) patch.price = price;
      if (item.unit !== unit) patch.unit = unit;
      if (Object.keys(patch).length) plan.itemPatches.push({ itemId: item.id, patch });
    }

    for (const r of relevant) {
      const square = round3(input.counts.get(r.variationId) ?? 0);
      const label = r.variationName.trim() || name;
      if (square < 0) plan.negatives.push({ itemName: name, label, qty: square });
      const target = round3(Math.max(0, square - (pending.get(r.variationId) ?? 0)));
      const lot = lotByVariation.get(r.variationId);
      if (!lot) {
        if (target > 0) plan.newLots.push({ squareItemId, itemId, variationId: r.variationId, label, qty: target, receivedAt: r.createdAt ?? input.now });
        continue;
      }
      if (Math.abs(target - lot.qtyRemaining) >= 0.001) plan.changes.push({ itemId: lot.itemId, lotId: lot.id, variationId: r.variationId, label, from: lot.qtyRemaining, to: target });
    }
  }
  return plan;
}

/** One line for the sync log. */
export function describePlan(plan: MirrorPlan): string {
  const parts: string[] = [];
  if (plan.newItems.length) parts.push(`${plan.newItems.length} new cut${plan.newItems.length === 1 ? "" : "s"}`);
  if (plan.newLots.length) parts.push(`${plan.newLots.length} new lot${plan.newLots.length === 1 ? "" : "s"}`);
  if (plan.changes.length) parts.push(`${plan.changes.length} lot count${plan.changes.length === 1 ? "" : "s"} updated`);
  if (plan.negatives.length) parts.push(`${plan.negatives.length} below zero in Square (held at 0)`);
  return parts.join(", ") || "already matched Square";
}
