import type { Integration, Item } from "@/lib/types";
import type { WriteOp } from "@/lib/store/types";
import { activityOp, importItems, type ImportRow } from "@/lib/inventory";
import { nowIso } from "@/lib/utils";
import { applyExclusions } from "./exclusions";
import type { Secrets, ServerContext } from "./server";
import { listItems, withCloverToken, type CloverItem } from "./clover";

/**
 * Pulls the Clover inventory into items: one item per Clover item, matched by
 * SKU (the name stands in when there is none), price from the item, the
 * product code as the barcode, the first category, hidden items inactive, and
 * for items new here Clover's cost and, when asked, its stock count as the
 * opening quantity.
 */

export interface CloverSyncResult {
  summary: string;
  items: { seen: number; created: number; updated: number; namedAsSku: number };
}

export interface CloverRow {
  row: ImportRow;
  itemId: string;
  modifiedAt?: string;
  /** Clover's count, applied only to items new here and only when asked. */
  qty?: number;
  /** Clover's cost, applied only to items new here: the costs of existing items are set by receipts. */
  cost?: number;
}

export function cloverRows(items: CloverItem[]): { rows: CloverRow[]; namedAsSku: number } {
  const rows: CloverRow[] = [];
  let namedAsSku = 0;
  for (const it of items) {
    if (it.deleted) continue;
    const name = it.name?.trim() ?? "";
    if (!name) continue;
    let sku = it.sku?.trim() ?? "";
    if (!sku) {
      sku = name;
      namedAsSku++;
    }
    const price = typeof it.price === "number" && it.priceType !== "VARIABLE" && it.price > 0 ? it.price / 100 : undefined;
    const cost = typeof it.cost === "number" && it.cost > 0 ? it.cost / 100 : undefined;
    const category = it.categories?.elements?.map((c) => c.name?.trim() ?? "").find(Boolean);
    const stock = it.itemStock?.quantity ?? it.itemStock?.stockCount;
    rows.push({
      itemId: it.id,
      modifiedAt: typeof it.modifiedTime === "number" && it.modifiedTime > 0 ? new Date(it.modifiedTime).toISOString() : undefined,
      qty: typeof stock === "number" && Number.isFinite(stock) ? stock : undefined,
      cost,
      row: { sku, name, category, price, barcode: it.code?.trim() || undefined, published: !it.hidden },
    });
  }
  return { rows, namedAsSku };
}

export async function runCloverSync(ctx: ServerContext, integration: Integration, secrets: Secrets): Promise<CloverSyncResult> {
  const cloverItems = await withCloverToken(ctx, secrets, (token, site) => listItems(site, token));
  const listed = cloverRows(cloverItems);
  const { namedAsSku } = listed;
  const firstSync = !integration.lastSyncAt;
  const takeStock = integration.settings?.takeStockOnFirstSync === true;
  const before = await ctx.store.list("items");
  const known = new Set(before.map((i) => i.sku.toUpperCase()));
  // Products deleted here stay deleted, whatever Clover still lists.
  const excluded = applyExclusions(integration, listed.rows, known);
  const rows = excluded.rows;
  const since = integration.lastSyncAt ? new Date(integration.lastSyncAt).getTime() - 5 * 60_000 : 0;
  const toImport = rows.filter((r) => firstSync || !known.has(r.row.sku.toUpperCase()) || !r.modifiedAt || new Date(r.modifiedAt).getTime() > since);
  const fresh = toImport.filter((r) => !known.has(r.row.sku.toUpperCase()));
  const existing = toImport.filter((r) => known.has(r.row.sku.toUpperCase()));
  const a = await importItems(ctx.store, ctx.actor, fresh.map((r) => ({ ...r.row, unitCost: r.cost, qty: takeStock ? r.qty : undefined })), { setQuantities: takeStock });
  const b = existing.length ? await importItems(ctx.store, ctx.actor, existing.map((r) => ({ ...r.row, qty: undefined }))) : { created: 0, updated: 0, skipped: 0, errors: [] };
  const items = await ctx.store.list("items");
  const bySku = new Map(items.map((i) => [i.sku.toUpperCase(), i]));
  const ops: WriteOp[] = [...excluded.ops];
  for (const r of rows) {
    const item = bySku.get(r.row.sku.toUpperCase());
    if (!item || item.externalIds?.clover === r.itemId) continue;
    const patch: Partial<Item> = { externalIds: { ...(item.externalIds ?? {}), clover: r.itemId } };
    ops.push({ op: "patch", collection: "items", id: item.id, patch });
  }
  const created = a.created + b.created;
  const updated = a.updated + b.updated;
  const summary = `${rows.length} item${rows.length === 1 ? "" : "s"} from Clover: ${created} new, ${updated} updated${namedAsSku ? `, ${namedAsSku} without a SKU filed under their name` : ""}${excluded.skipped ? `, ${excluded.skipped} deleted here kept out` : ""}`;
  ops.push({ op: "patch", collection: "integrations", id: "clover", patch: { lastSyncAt: nowIso(), lastSyncSummary: summary, lastError: undefined, status: "connected" } });
  ops.push(activityOp(ctx.actor, "integration.synced", `Clover sync: ${summary}`, { entityType: "integration", entityId: "clover", meta: { created, updated } }));
  await ctx.store.batch(ops);
  return { summary, items: { seen: rows.length, created, updated, namedAsSku } };
}
