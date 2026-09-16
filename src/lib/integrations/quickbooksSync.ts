import type { Integration, Item } from "@/lib/types";
import type { WriteOp } from "@/lib/store/types";
import { activityOp, importItems, type ImportRow } from "@/lib/inventory";
import { nowIso } from "@/lib/utils";
import type { Secrets, ServerContext } from "./server";
import { listItems, withToken, type QboEnvironment, type QboItem } from "./quickbooks";

/**
 * Pulls Products and Services from QuickBooks Online into items, matched by
 * SKU and remembered by QuickBooks id in `externalIds.quickbooks`. Many
 * QuickBooks companies leave SKU empty, so the item name stands in for it.
 * Categories and groups are skipped; sub-items keep their parent as the category.
 */

export interface QboSyncResult {
  summary: string;
  items: { seen: number; created: number; updated: number; namedAsSku: number; skippedOther: number };
}

export function quickbooksRows(items: QboItem[]): { rows: Array<{ row: ImportRow; qboId: string; modifiedAt?: string }>; namedAsSku: number; skippedOther: number } {
  const rows: Array<{ row: ImportRow; qboId: string; modifiedAt?: string }> = [];
  let namedAsSku = 0;
  let skippedOther = 0;
  for (const it of items) {
    if (it.Type === "Category" || it.Type === "Group") {
      skippedOther++;
      continue;
    }
    let sku = it.Sku?.trim() ?? "";
    if (!sku) {
      sku = it.Name.trim();
      if (!sku) {
        skippedOther++;
        continue;
      }
      namedAsSku++;
    }
    rows.push({
      qboId: it.Id,
      modifiedAt: it.MetaData?.LastUpdatedTime ? new Date(it.MetaData.LastUpdatedTime).toISOString() : undefined,
      row: {
        sku,
        name: it.Name,
        description: it.Description?.trim() || undefined,
        category: it.SubItem && it.ParentRef?.name ? it.ParentRef.name : undefined,
        price: typeof it.UnitPrice === "number" && it.UnitPrice > 0 ? it.UnitPrice : undefined,
        unitCost: typeof it.PurchaseCost === "number" && it.PurchaseCost > 0 ? it.PurchaseCost : undefined,
        qty: it.Type === "Inventory" && typeof it.QtyOnHand === "number" ? it.QtyOnHand : undefined,
        minQty: typeof it.ReorderPoint === "number" && it.ReorderPoint > 0 ? it.ReorderPoint : undefined,
        published: it.Active,
      },
    });
  }
  return { rows, namedAsSku, skippedOther };
}

export async function runQuickbooksSync(ctx: ServerContext, integration: Integration, secrets: Secrets): Promise<QboSyncResult> {
  const environment = (secrets.environment as QboEnvironment | undefined) ?? "sandbox";
  const all = await withToken(ctx, secrets, (token, realmId) => listItems(environment, token, realmId));
  const { rows, namedAsSku, skippedOther } = quickbooksRows(all);
  const firstSync = !integration.lastSyncAt;
  const takeStock = integration.settings?.takeStockOnFirstSync === true;
  const before = await ctx.store.list("items");
  const knownSkus = new Set(before.map((i) => i.sku.toUpperCase()));
  // After the first sync only records QuickBooks changed since then are re-imported; the rest keep local edits.
  const since = integration.lastSyncAt ? new Date(integration.lastSyncAt).getTime() - 5 * 60_000 : 0;
  const toImport = rows.filter((r) => firstSync || !knownSkus.has(r.row.sku.toUpperCase()) || !r.modifiedAt || new Date(r.modifiedAt).getTime() > since);
  // Opening counts come from QuickBooks only for items that do not exist here yet; existing counts are never overwritten by a pull.
  const fresh = toImport.filter((r) => !knownSkus.has(r.row.sku.toUpperCase()));
  const known = toImport.filter((r) => knownSkus.has(r.row.sku.toUpperCase()));
  const a = await importItems(ctx.store, ctx.actor, fresh.map((r) => (takeStock ? r.row : { ...r.row, qty: undefined })), { setQuantities: takeStock });
  const b = known.length ? await importItems(ctx.store, ctx.actor, known.map((r) => ({ ...r.row, qty: undefined }))) : { created: 0, updated: 0, skipped: 0, errors: [] };
  const result = { created: a.created + b.created, updated: a.updated + b.updated };

  const items = await ctx.store.list("items");
  const bySku = new Map(items.map((i) => [i.sku.toUpperCase(), i]));
  const ops: WriteOp[] = [];
  for (const r of rows) {
    const item = bySku.get(r.row.sku.toUpperCase());
    if (!item || item.externalIds?.quickbooks === r.qboId) continue;
    const patch: Partial<Item> = { externalIds: { ...(item.externalIds ?? {}), quickbooks: r.qboId } };
    ops.push({ op: "patch", collection: "items", id: item.id, patch });
  }
  const finishedAt = nowIso();
  const summary = `${rows.length} product${rows.length === 1 ? "" : "s"} from QuickBooks: ${result.created} new, ${result.updated} updated${namedAsSku ? `, ${namedAsSku} without a SKU filed under their name` : ""}${skippedOther ? `, ${skippedOther} categor${skippedOther === 1 ? "y/bundle" : "ies/bundles"} skipped` : ""}`;
  ops.push({ op: "patch", collection: "integrations", id: "quickbooks", patch: { lastSyncAt: finishedAt, lastSyncSummary: summary, lastError: undefined, status: "connected" } });
  ops.push(activityOp(ctx.actor, "integration.synced", `QuickBooks sync: ${summary}`, { entityType: "integration", entityId: "quickbooks", meta: { created: result.created, updated: result.updated } }));
  await ctx.store.batch(ops);
  return { summary, items: { seen: all.length, created: result.created, updated: result.updated, namedAsSku, skippedOther } };
}
