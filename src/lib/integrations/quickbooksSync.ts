import type { Integration, Item } from "@/lib/types";
import type { WriteOp } from "@/lib/store/types";
import { activityOp, importItems, type ImportRow } from "@/lib/inventory";
import { nowIso } from "@/lib/utils";
import { applyExclusions } from "./exclusions";
import { HttpError, loadConnected, type Secrets, type ServerContext } from "./server";
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

/** One line per step of a sync, for callers that show it as it happens (the live-sync WebSocket). */
export interface QboSyncProgress {
  step: "reading" | "comparing" | "importing" | "finishing";
  message: string;
}

export async function runQuickbooksSync(ctx: ServerContext, integration: Integration, secrets: Secrets, onProgress: (p: QboSyncProgress) => void = () => {}): Promise<QboSyncResult> {
  const environment = (secrets.environment as QboEnvironment | undefined) ?? "sandbox";
  onProgress({ step: "reading", message: "Reading products and services from QuickBooks" });
  const all = await withToken(ctx, secrets, (token, realmId) => listItems(environment, token, realmId));
  onProgress({ step: "comparing", message: `${all.length} record${all.length === 1 ? "" : "s"} read. Comparing with your items` });
  const listed = quickbooksRows(all);
  const { namedAsSku, skippedOther } = listed;
  const firstSync = !integration.lastSyncAt;
  const takeStock = integration.settings?.takeStockOnFirstSync === true;
  const before = await ctx.store.list("items");
  const knownSkus = new Set(before.map((i) => i.sku.toUpperCase()));
  // Products deleted here stay deleted, whatever QuickBooks still lists.
  const excluded = applyExclusions(integration, listed.rows, knownSkus);
  const rows = excluded.rows;
  // After the first sync only records QuickBooks changed since then are re-imported; the rest keep local edits.
  const since = integration.lastSyncAt ? new Date(integration.lastSyncAt).getTime() - 5 * 60_000 : 0;
  const toImport = rows.filter((r) => firstSync || !knownSkus.has(r.row.sku.toUpperCase()) || !r.modifiedAt || new Date(r.modifiedAt).getTime() > since);
  // Opening counts come from QuickBooks only for items that do not exist here yet; existing counts are never overwritten by a pull.
  const fresh = toImport.filter((r) => !knownSkus.has(r.row.sku.toUpperCase()));
  const known = toImport.filter((r) => knownSkus.has(r.row.sku.toUpperCase()));
  onProgress({ step: "importing", message: toImport.length ? `Importing ${fresh.length} new and ${known.length} changed product${toImport.length === 1 ? "" : "s"}` : "Nothing new or changed to import" });
  const a = await importItems(ctx.store, ctx.actor, fresh.map((r) => (takeStock ? r.row : { ...r.row, qty: undefined })), { setQuantities: takeStock });
  const b = known.length ? await importItems(ctx.store, ctx.actor, known.map((r) => ({ ...r.row, qty: undefined }))) : { created: 0, updated: 0, skipped: 0, errors: [] };
  const result = { created: a.created + b.created, updated: a.updated + b.updated };

  onProgress({ step: "finishing", message: "Linking items to their QuickBooks records" });
  const items = await ctx.store.list("items");
  const bySku = new Map(items.map((i) => [i.sku.toUpperCase(), i]));
  const ops: WriteOp[] = [...excluded.ops];
  for (const r of rows) {
    const item = bySku.get(r.row.sku.toUpperCase());
    if (!item || item.externalIds?.quickbooks === r.qboId) continue;
    const patch: Partial<Item> = { externalIds: { ...(item.externalIds ?? {}), quickbooks: r.qboId } };
    ops.push({ op: "patch", collection: "items", id: item.id, patch });
  }
  const finishedAt = nowIso();
  const summary = `${rows.length} product${rows.length === 1 ? "" : "s"} from QuickBooks: ${result.created} new, ${result.updated} updated${namedAsSku ? `, ${namedAsSku} without a SKU filed under their name` : ""}${skippedOther ? `, ${skippedOther} categor${skippedOther === 1 ? "y/bundle" : "ies/bundles"} skipped` : ""}${excluded.skipped ? `, ${excluded.skipped} deleted here kept out` : ""}`;
  ops.push({ op: "patch", collection: "integrations", id: "quickbooks", patch: { lastSyncAt: finishedAt, lastSyncSummary: summary, lastError: undefined, status: "connected" } });
  ops.push(activityOp(ctx.actor, "integration.synced", `QuickBooks sync: ${summary}`, { entityType: "integration", entityId: "quickbooks", meta: { created: result.created, updated: result.updated } }));
  await ctx.store.batch(ops);
  return { summary, items: { seen: all.length, created: result.created, updated: result.updated, namedAsSku, skippedOther } };
}

/**
 * A whole sync of the workspace's QuickBooks connection, start to finish: loads
 * the stored connection, runs the pull, and records a failure on the connection
 * the same way POST /api/integrations/quickbooks/sync does.
 */
export async function syncQuickbooksNow(ctx: ServerContext, onProgress?: (p: QboSyncProgress) => void): Promise<QboSyncResult> {
  const { integration, secrets } = await loadConnected(ctx, "quickbooks");
  try {
    return await runQuickbooksSync(ctx, integration, secrets, onProgress);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await ctx.store.patch("integrations", "quickbooks", { lastError: message, status: e instanceof HttpError && e.status === 401 ? "error" : "connected", lastSyncAt: nowIso() });
    throw e;
  }
}
