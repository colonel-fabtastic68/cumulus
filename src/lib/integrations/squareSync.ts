import type { Integration, Item } from "@/lib/types";
import type { WriteOp } from "@/lib/store/types";
import { activityOp, importItems, type ImportRow } from "@/lib/inventory";
import { nowIso } from "@/lib/utils";
import type { Secrets, ServerContext } from "./server";
import { inventoryCounts, listCatalog, withSquareToken, type SquareCategory, type SquareItem } from "./square";

/**
 * Pulls the Square item library into items: one item per variation, matched
 * by SKU (the variation name stands in when there is none), price from the
 * variation, category from the catalog, and Square's in-stock count as the
 * opening quantity for items new here when asked.
 */

export interface SquareSyncResult {
  summary: string;
  items: { seen: number; created: number; updated: number; namedAsSku: number };
}

export function squareRows(items: SquareItem[], categories: SquareCategory[]): { rows: Array<{ row: ImportRow; variationId: string; modifiedAt?: string }>; namedAsSku: number } {
  const catName = new Map(categories.map((c) => [c.id, c.category_data?.name ?? ""]));
  const rows: Array<{ row: ImportRow; variationId: string; modifiedAt?: string }> = [];
  let namedAsSku = 0;
  for (const it of items) {
    if (it.is_deleted) continue;
    const d = it.item_data;
    if (!d?.name) continue;
    const variations = d.variations ?? [];
    for (const v of variations) {
      const vd = v.item_variation_data ?? {};
      const multi = variations.length > 1;
      const name = multi && vd.name && vd.name !== "Regular" ? `${d.name} – ${vd.name}` : d.name;
      let sku = vd.sku?.trim() ?? "";
      if (!sku) {
        sku = name.trim();
        namedAsSku++;
      }
      const price = typeof vd.price_money?.amount === "number" ? vd.price_money.amount / 100 : undefined;
      rows.push({
        variationId: v.id,
        modifiedAt: v.updated_at ?? it.updated_at,
        row: { sku, name, description: d.description?.trim() || undefined, category: d.category_id ? catName.get(d.category_id) || undefined : undefined, price: price && price > 0 ? price : undefined, barcode: vd.upc?.trim() || undefined, published: true },
      });
    }
  }
  return { rows, namedAsSku };
}

export async function runSquareSync(ctx: ServerContext, integration: Integration, secrets: Secrets): Promise<SquareSyncResult> {
  const locationIds = integration.config?.locationIds ? integration.config.locationIds.split(",").filter(Boolean) : [];
  const { items: catalogItems, categories, counts } = await withSquareToken(ctx, secrets, async (token, environment) => {
    const catalog = await listCatalog(environment, token);
    const tracked = catalog.items.flatMap((i) => (i.item_data?.variations ?? []).filter((v) => v.item_variation_data?.track_inventory !== false).map((v) => v.id));
    const counts = integration.settings?.takeStockOnFirstSync ? await inventoryCounts(environment, token, tracked, locationIds) : new Map<string, number>();
    return { ...catalog, counts };
  });
  const { rows, namedAsSku } = squareRows(catalogItems, categories);
  const firstSync = !integration.lastSyncAt;
  const takeStock = integration.settings?.takeStockOnFirstSync === true;
  const before = await ctx.store.list("items");
  const known = new Set(before.map((i) => i.sku.toUpperCase()));
  const since = integration.lastSyncAt ? new Date(integration.lastSyncAt).getTime() - 5 * 60_000 : 0;
  const toImport = rows.filter((r) => firstSync || !known.has(r.row.sku.toUpperCase()) || !r.modifiedAt || new Date(r.modifiedAt).getTime() > since);
  const fresh = toImport.filter((r) => !known.has(r.row.sku.toUpperCase()));
  const existing = toImport.filter((r) => known.has(r.row.sku.toUpperCase()));
  const a = await importItems(ctx.store, ctx.actor, fresh.map((r) => ({ ...r.row, qty: takeStock ? counts.get(r.variationId) : undefined })), { setQuantities: takeStock });
  const b = existing.length ? await importItems(ctx.store, ctx.actor, existing.map((r) => ({ ...r.row, qty: undefined }))) : { created: 0, updated: 0, skipped: 0, errors: [] };
  const items = await ctx.store.list("items");
  const bySku = new Map(items.map((i) => [i.sku.toUpperCase(), i]));
  const ops: WriteOp[] = [];
  for (const r of rows) {
    const item = bySku.get(r.row.sku.toUpperCase());
    if (!item || item.externalIds?.square === r.variationId) continue;
    const patch: Partial<Item> = { externalIds: { ...(item.externalIds ?? {}), square: r.variationId } };
    ops.push({ op: "patch", collection: "items", id: item.id, patch });
  }
  const created = a.created + b.created;
  const updated = a.updated + b.updated;
  const summary = `${rows.length} variation${rows.length === 1 ? "" : "s"} from Square: ${created} new, ${updated} updated${namedAsSku ? `, ${namedAsSku} without a SKU filed under their name` : ""}`;
  ops.push({ op: "patch", collection: "integrations", id: "square", patch: { lastSyncAt: nowIso(), lastSyncSummary: summary, lastError: undefined, status: "connected" } });
  ops.push(activityOp(ctx.actor, "integration.synced", `Square sync: ${summary}`, { entityType: "integration", entityId: "square", meta: { created, updated } }));
  await ctx.store.batch(ops);
  return { summary, items: { seen: rows.length, created, updated, namedAsSku } };
}
