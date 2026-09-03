import type { Build, Item, StockMovement } from "@/lib/types";
import { isLowStock } from "@/lib/inventory";
import { round, sum } from "@/lib/utils";

export const WINDOW_DAYS = 30;

export function withinDays(iso: string | undefined, days: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= days * 86_400_000;
}

/** Effective date of a build: when it completed, else when it was recorded. */
export function buildDate(build: Build): string {
  return build.completedAt ?? build.createdAt;
}

/** Recorded more than a day after its effective date (same rule as stock movements). */
export function isBackDatedBuild(build: Build): boolean {
  return new Date(build.createdAt).getTime() - new Date(buildDate(build)).getTime() > 86_400_000;
}

/** An assembly that can actually be built: active with a bill of materials. */
export function isBuildableAssembly(item: Item): boolean {
  return item.type === "assembly" && item.bom.length > 0 && item.status === "active";
}

export interface ComponentRow {
  itemId: string;
  item?: Item;
  qtyPer: number;
  qtyConsumed: number;
  unitCost: number;
  extended: number;
}

/**
 * Component lines for a build with the cost captured on the ledger at the time.
 * Falls back to the item's current standard cost for builds without movements (e.g. seed data).
 */
export function buildComponentRows(build: Build, itemsById: Map<string, Item>, movements: StockMovement[]): ComponentRow[] {
  const costByItem = new Map<string, number>();
  for (const m of movements) {
    if (m.refType === "build" && m.refId === build.id && m.type === "build_consume" && m.unitCost !== undefined) costByItem.set(m.itemId, m.unitCost);
  }
  return build.components.map((c) => {
    const item = itemsById.get(c.itemId);
    const unitCost = costByItem.get(c.itemId) ?? item?.unitCost ?? 0;
    return { itemId: c.itemId, item, qtyPer: c.qtyPer, qtyConsumed: c.qtyConsumed, unitCost, extended: round(c.qtyConsumed * unitCost) };
  });
}

export interface BuildStatsResult {
  unitsBuilt: number;
  buildCount: number;
  belowMin: number;
  assemblyCount: number;
}

export function computeBuildStats(builds: Build[], items: Item[]): BuildStatsResult {
  const recent = builds.filter((b) => b.status === "completed" && withinDays(buildDate(b), WINDOW_DAYS));
  const assemblies = items.filter(isBuildableAssembly);
  return {
    unitsBuilt: sum(recent.map((b) => b.qty)),
    buildCount: recent.length,
    belowMin: assemblies.filter(isLowStock).length,
    assemblyCount: assemblies.length,
  };
}
