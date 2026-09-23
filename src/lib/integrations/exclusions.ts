import type { Integration } from "@/lib/types";
import type { WriteOp } from "@/lib/store/types";

/**
 * SKUs deleted in cumulusOS stay deleted. Every connection keeps the list of
 * SKUs deleted here, and its pulls (full syncs and webhooks) skip those rows
 * until the item exists here again, at which point the SKU drops off the list.
 */

export function excludedSkuSet(integration: Pick<Integration, "excludedSkus">): Set<string> {
  return new Set((integration.excludedSkus ?? []).map((s) => s.toUpperCase()));
}

export interface ExclusionResult<T> {
  rows: T[];
  /** Rows kept out because the SKU was deleted here and does not exist now. */
  skipped: number;
  /** Ops that drop SKUs from the list once the item is back, so a later delete starts clean. */
  ops: WriteOp[];
}

/** Drops rows for SKUs deleted here unless the item exists again locally. */
export function applyExclusions<T extends { row: { sku: string } }>(integration: Integration, rows: T[], knownSkus: Set<string>): ExclusionResult<T> {
  const excluded = excludedSkuSet(integration);
  if (excluded.size === 0) return { rows, skipped: 0, ops: [] };
  const kept: T[] = [];
  let skipped = 0;
  const lifted = new Set<string>();
  for (const r of rows) {
    const sku = r.row.sku.toUpperCase();
    if (!excluded.has(sku)) {
      kept.push(r);
      continue;
    }
    if (knownSkus.has(sku)) {
      lifted.add(sku);
      kept.push(r);
      continue;
    }
    skipped++;
  }
  const ops: WriteOp[] = lifted.size ? [{ op: "patch", collection: "integrations", id: integration.id, patch: { excludedSkus: (integration.excludedSkus ?? []).filter((s) => !lifted.has(s.toUpperCase())) } }] : [];
  return { rows: kept, skipped, ops };
}

/** One line for a sync summary, or nothing when nothing was kept out. */
export function describeSkipped(skipped: number): string {
  return skipped ? `${skipped} deleted here kept out` : "";
}
