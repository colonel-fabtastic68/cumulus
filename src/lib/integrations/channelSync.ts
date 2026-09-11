import type { Address, Integration, Item, ItemStock } from "@/lib/types";
import type { WriteOp } from "@/lib/store/types";
import { activityOp, adjustStock, cancelOrder, createOrder, defaultLocation, importItems, qtyAt, type ImportRow } from "@/lib/inventory";
import { nowIso } from "@/lib/utils";
import { HttpError, type Secrets, type ServerContext } from "./server";
import * as shopify from "./shopify";
import * as woo from "./woocommerce";

/**
 * Factor 40: two-way sync with sales channels. Products come in as items
 * (matched by SKU), paid orders come in as sales orders, and on-hand counts go
 * back out so the storefront never oversells.
 */

export type ChannelId = "shopify" | "woocommerce";

export function isChannel(id: string): id is ChannelId {
  return id === "shopify" || id === "woocommerce";
}

export interface SyncOptions {
  products: boolean;
  orders: boolean;
}

export interface SyncResult {
  summary: string;
  products?: { seen: number; created: number; updated: number; skippedNoSku: number; unlinked?: number };
  orders?: { seen: number; created: number; alreadyIn: number; skippedNoLines: number; warnings: string[] };
}

function shopifyCreds(integration: Integration, secrets: Secrets): shopify.ShopifyCreds {
  const shop = integration.config?.shop;
  if (!shop || !secrets.accessToken) throw new HttpError(409, "Shopify credentials are incomplete; connect it again.");
  return { shop, accessToken: secrets.accessToken };
}

/** Connections made before permalink detection existed learn their REST style on first use. */
async function wooCreds(ctx: ServerContext, integration: Integration, secrets: Secrets): Promise<woo.WooCreds> {
  const siteUrl = integration.config?.siteUrl;
  if (!siteUrl || !secrets.consumerKey || !secrets.consumerSecret) throw new HttpError(409, "WooCommerce credentials are incomplete; connect it again.");
  let plainPermalinks = integration.config?.plainPermalinks === "1";
  let authMode = integration.config?.authMode as woo.WooAuthMode | undefined;
  if (integration.config?.plainPermalinks === undefined || !authMode) {
    plainPermalinks = (await woo.detectPermalinks(siteUrl)).plainPermalinks;
    if (plainPermalinks) throw new HttpError(409, woo.PLAIN_PERMALINKS_HELP);
    authMode = await woo.detectAuthMode({ siteUrl, consumerKey: secrets.consumerKey, consumerSecret: secrets.consumerSecret, plainPermalinks });
    const config = { ...(integration.config ?? {}), plainPermalinks: "0", authMode };
    integration.config = config;
    await ctx.store.patch("integrations", integration.id, { config });
  }
  return { siteUrl, consumerKey: secrets.consumerKey, consumerSecret: secrets.consumerSecret, plainPermalinks, authMode };
}

// ---- products ------------------------------------------------------------------

interface ChannelRow {
  row: ImportRow;
  ref: NonNullable<Item["channels"]>;
  weightUnit?: string;
  /** When the store last changed the record, so unchanged products are not re-imported over local edits. */
  modifiedAt?: string;
}

function shopifyRows(products: shopify.ShopifyProduct[]): { rows: ChannelRow[]; skippedNoSku: number } {
  const rows: ChannelRow[] = [];
  let skippedNoSku = 0;
  for (const p of products) {
    const multi = p.variants.length > 1;
    for (const v of p.variants) {
      const sku = v.sku?.trim();
      if (!sku) {
        skippedNoSku++;
        continue;
      }
      rows.push({
        row: {
          sku,
          name: multi && v.title && v.title !== "Default Title" ? `${p.title} – ${v.title}` : p.title,
          category: p.product_type || undefined,
          brand: p.vendor || undefined,
          tags: p.tags ? p.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
          price: Number(v.price) || undefined,
          barcode: v.barcode?.trim() || undefined,
          qty: v.inventory_management ? v.inventory_quantity : undefined,
          weight: v.weight || undefined,
          imageUrl: p.image?.src,
          externalId: String(p.id),
          externalSource: "shopify",
          published: p.status === "active",
        },
        ref: { shopify: { productId: String(p.id), variantId: String(v.id), inventoryItemId: String(v.inventory_item_id) } },
        weightUnit: v.weight_unit,
        modifiedAt: p.updated_at ? new Date(p.updated_at).toISOString() : undefined,
      });
    }
  }
  return { rows, skippedNoSku };
}

function wooRows(list: Array<{ product: woo.WooProduct; variation?: woo.WooVariation }>, weightUnit?: string): { rows: ChannelRow[]; skippedNoSku: number } {
  const rows: ChannelRow[] = [];
  let skippedNoSku = 0;
  for (const { product, variation } of list) {
    const source = variation ?? product;
    const sku = source.sku?.trim();
    if (!sku) {
      skippedNoSku++;
      continue;
    }
    const options = variation?.attributes?.map((a) => a.option).filter(Boolean).join(" / ");
    rows.push({
      row: {
        sku,
        name: variation ? `${product.name}${options ? ` – ${options}` : ""}` : product.name,
        category: product.categories?.[0]?.name,
        tags: product.tags?.map((t) => t.name),
        price: Number(source.price || source.regular_price) || undefined,
        barcode: source.global_unique_id?.trim() || undefined,
        qty: source.manage_stock && source.stock_quantity !== null ? source.stock_quantity : undefined,
        minQty: source.low_stock_amount ?? undefined,
        weight: Number(source.weight) || undefined,
        imageUrl: variation?.image?.src ?? product.images?.[0]?.src,
        externalId: String(product.id),
        externalSource: "woocommerce",
        published: product.status === "publish" && (variation ? variation.status === "publish" : true),
      },
      ref: { woocommerce: { productId: String(product.id), variationId: variation ? String(variation.id) : undefined } },
      weightUnit: weightUnit,
      modifiedAt: (variation?.date_modified_gmt ?? product.date_modified_gmt) ? new Date(`${variation?.date_modified_gmt ?? product.date_modified_gmt}Z`).toISOString() : undefined,
    });
  }
  return { rows, skippedNoSku };
}

async function syncProducts(ctx: ServerContext, integration: Integration, secrets: Secrets): Promise<NonNullable<SyncResult["products"]>> {
  const id = integration.id as ChannelId;
  const { rows, skippedNoSku } = id === "shopify" ? shopifyRows(await shopify.listProducts(shopifyCreds(integration, secrets))) : wooRows(await woo.listProducts(await wooCreds(ctx, integration, secrets)), integration.config?.weightUnit);
  const firstSync = !integration.lastSyncAt;
  const takeStock = firstSync && integration.settings?.takeStockOnFirstSync === true;
  const before = await ctx.store.list("items");
  const knownSkus = new Set(before.map((i) => i.sku.toUpperCase()));
  // After the first sync only records the store changed since then are re-imported; the rest keep local edits.
  const since = integration.lastSyncAt ? new Date(integration.lastSyncAt).getTime() - 5 * 60_000 : 0;
  const toImport = rows.filter((r) => firstSync || !knownSkus.has(r.row.sku.toUpperCase()) || !r.modifiedAt || new Date(r.modifiedAt).getTime() > since);
  const result = await importItems(ctx.store, ctx.actor, toImport.map((r) => (takeStock ? r.row : { ...r.row, qty: undefined })), { setQuantities: takeStock });
  // Remember which channel record each item mirrors, so orders and stock pushes match by id, not just SKU.
  const items = await ctx.store.list("items");
  const bySku = new Map(items.map((i) => [i.sku.toUpperCase(), i]));
  const ops: WriteOp[] = [];
  const storeKeys = new Set<string>();
  for (const r of rows) {
    const ref = r.ref[id]!;
    storeKeys.add(channelKey(ref));
    const item = bySku.get(r.row.sku.toUpperCase());
    if (!item) continue;
    const current = item.channels?.[id];
    const patch: Partial<Item> = {};
    if (!current || channelKey(current) !== channelKey(ref)) patch.channels = { ...(item.channels ?? {}), ...r.ref };
    if (r.weightUnit && r.row.weight && item.weightUnit !== r.weightUnit) patch.weightUnit = r.weightUnit;
    if (Object.keys(patch).length) ops.push({ op: "patch", collection: "items", id: item.id, patch });
  }
  // Products that vanished from the store: unlink the item (and deactivate it when asked to).
  // An empty listing is treated as a failed read rather than an emptied store, so nothing is unlinked on a hiccup.
  let unlinked = 0;
  const deactivate = integration.settings?.deactivateOnStoreDelete === true;
  for (const item of rows.length === 0 ? [] : items) {
    const ref = item.channels?.[id];
    if (!ref || storeKeys.has(channelKey(ref))) continue;
    const channels = { ...(item.channels ?? {}) };
    delete channels[id];
    const patch: Partial<Item> = { channels };
    if (deactivate && item.status === "active") patch.status = "inactive";
    ops.push({ op: "patch", collection: "items", id: item.id, patch });
    unlinked++;
  }
  if (unlinked) ops.push(activityOp(ctx.actor, "integration.synced", `${NAME[id]} no longer has ${unlinked} linked product${unlinked === 1 ? "" : "s"}; ${deactivate ? "deactivated and " : ""}unlinked here`, { entityType: "integration", entityId: id }));
  if (ops.length) await ctx.store.batch(ops);
  return { seen: rows.length + skippedNoSku, created: result.created, updated: result.updated, skippedNoSku, unlinked };
}

const NAME: Record<ChannelId, string> = { shopify: "Shopify", woocommerce: "WooCommerce" };

function channelKey(ref: { productId: string; variantId?: string; variationId?: string }): string {
  return `${ref.productId}:${"variantId" in ref ? (ref.variantId ?? "") : (ref.variationId ?? "")}`;
}

/** Removes store products for items deleted here, then clears the tombstones. */
export async function processTombstones(ctx: ServerContext, integration: Integration, secrets: Secrets): Promise<{ removed: number; errors: string[] }> {
  const id = integration.id as ChannelId;
  const tombstones = (await ctx.store.list("channelTombstones")).filter((t) => t.channel === id);
  const out = { removed: 0, errors: [] as string[] };
  if (tombstones.length === 0) return out;
  const remove = integration.settings?.removeFromStoreOnDelete !== false;
  const done: WriteOp[] = [];
  if (remove) {
    if (id === "shopify") {
      const creds = shopifyCreds(integration, secrets);
      for (const t of tombstones) {
        try {
          await shopify.removeProduct(creds, (t.ref as { productId: string }).productId);
          out.removed++;
          done.push({ op: "remove", collection: "channelTombstones", id: t.id });
        } catch (e) {
          out.errors.push(`${t.sku}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } else {
      const creds = await wooCreds(ctx, integration, secrets);
      for (const t of tombstones) {
        try {
          await woo.deleteProduct(creds, t.ref as woo.WooRef);
          out.removed++;
          done.push({ op: "remove", collection: "channelTombstones", id: t.id });
        } catch (e) {
          out.errors.push(`${t.sku}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  } else {
    for (const t of tombstones) done.push({ op: "remove", collection: "channelTombstones", id: t.id });
  }
  if (out.removed) done.push(activityOp(ctx.actor, "integration.synced", `Removed ${out.removed} product${out.removed === 1 ? "" : "s"} from ${NAME[id]} for items deleted here`, { entityType: "integration", entityId: id }));
  if (done.length) await ctx.store.batch(done);
  return out;
}

/** Sends name, price, description and status for linked items changed since the last push (or the given ids). */
export async function pushItemDetails(ctx: ServerContext, integration: Integration, secrets: Secrets, itemIds?: string[]): Promise<{ updated: number; errors: string[] }> {
  const id = integration.id as ChannelId;
  const since = integration.lastDetailsPushAt ?? integration.lastSyncAt ?? integration.connectedAt ?? "";
  const items = (await ctx.store.list("items")).filter((i) => !!i.channels?.[id] && (itemIds ? itemIds.includes(i.id) : i.updatedAt > since));
  const out = { updated: 0, errors: [] as string[] };
  const startedAt = nowIso();
  if (items.length === 0) return out;
  if (id === "shopify") {
    const creds = shopifyCreds(integration, secrets);
    await mapConcurrent(items, 4, async (item) => {
      const ref = item.channels!.shopify!;
      try {
        await shopify.updateProduct(creds, ref.productId, { title: item.name, body_html: item.description ?? "", vendor: item.brand, product_type: item.category, tags: item.tags, status: item.status === "active" ? undefined : "archived" });
        await shopify.updateVariant(creds, ref.variantId, { price: item.price, sku: item.sku, barcode: item.barcode ?? "", weight: item.weight, weight_unit: item.weightUnit });
        out.updated++;
      } catch (e) {
        out.errors.push(`${item.sku}: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  } else {
    const creds = await wooCreds(ctx, integration, secrets);
    await mapConcurrent(items, 4, async (item) => {
      try {
        await woo.updateProduct(creds, item.channels!.woocommerce!, { name: item.name, description: item.description ?? "", price: item.price, weight: item.weight ?? 0, dimensions: item.dimensions, barcode: item.barcode ?? "", status: item.status === "active" ? undefined : "draft" });
        out.updated++;
      } catch (e) {
        out.errors.push(`${item.sku}: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  }
  if (!itemIds) await ctx.store.patch("integrations", id, { lastDetailsPushAt: startedAt });
  return out;
}

/** Unlinks (and optionally deactivates) the item whose store product was deleted. */
async function productDeletedInStore(ctx: ServerContext, integration: Integration, match: (item: Item) => boolean): Promise<string> {
  const id = integration.id as ChannelId;
  const items = (await ctx.store.list("items")).filter((i) => !!i.channels?.[id] && match(i));
  if (items.length === 0) return "no linked item";
  const deactivate = integration.settings?.deactivateOnStoreDelete === true;
  const ops: WriteOp[] = items.map((item) => {
    const channels = { ...(item.channels ?? {}) };
    delete channels[id];
    return { op: "patch", collection: "items", id: item.id, patch: { channels, ...(deactivate && item.status === "active" ? { status: "inactive" as const } : {}) } };
  });
  ops.push(activityOp(ctx.actor, "integration.synced", `${NAME[id]} deleted ${items.map((i) => i.sku).join(", ")}; ${deactivate ? "deactivated and " : ""}unlinked here`, { entityType: "integration", entityId: id }));
  await ctx.store.batch(ops);
  return `${items.map((i) => i.sku).join(", ")} unlinked${deactivate ? " and deactivated" : ""}`;
}

/** Applies a store-side product edit to the linked item (name, price, description…), then links it. */
async function productUpdatedInStore(ctx: ServerContext, integration: Integration, rows: ChannelRow[]): Promise<string> {
  if (rows.length === 0) return "no SKU on the product";
  const result = await importItems(ctx.store, ctx.actor, rows.map((r) => ({ ...r.row, qty: undefined })), {});
  const items = await ctx.store.list("items");
  const bySku = new Map(items.map((i) => [i.sku.toUpperCase(), i]));
  const ops: WriteOp[] = [];
  for (const r of rows) {
    const item = bySku.get(r.row.sku.toUpperCase());
    if (item) ops.push({ op: "patch", collection: "items", id: item.id, patch: { channels: { ...(item.channels ?? {}), ...r.ref } } });
  }
  if (ops.length) await ctx.store.batch(ops);
  return `${rows.map((r) => r.row.sku).join(", ")}: ${result.created ? "created" : "updated"} from the store`;
}

// ---- orders --------------------------------------------------------------------

interface IncomingOrder {
  externalId: string;
  externalRef: string;
  customer: string;
  customerEmail?: string;
  shipTo?: Address;
  note?: string;
  cancelled: boolean;
  lines: Array<{ sku?: string; channelKey?: string; qty: number; unitPrice: number; title: string }>;
}

function shopifyAddress(a?: shopify.ShopifyAddress | null): Address | undefined {
  if (!a?.address1 || !a.city || !a.zip || !a.country_code) return undefined;
  return { name: a.name || undefined, company: a.company || undefined, street1: a.address1, street2: a.address2 || undefined, city: a.city, state: a.province_code || undefined, zip: a.zip, country: a.country_code, phone: a.phone || undefined };
}

function fromShopifyOrder(o: shopify.ShopifyOrder): IncomingOrder {
  const customerName = [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ").trim();
  return {
    externalId: String(o.id),
    externalRef: o.name,
    customer: o.shipping_address?.name || customerName || o.email || o.name,
    customerEmail: o.email ?? o.customer?.email ?? undefined,
    shipTo: shopifyAddress(o.shipping_address) ?? shopifyAddress(o.billing_address),
    note: o.note ?? undefined,
    cancelled: !!o.cancelled_at,
    lines: o.line_items.map((li) => ({ sku: li.sku ?? undefined, channelKey: li.variant_id ? String(li.variant_id) : undefined, qty: li.fulfillable_quantity ?? li.quantity, unitPrice: Number(li.price) || 0, title: li.title })),
  };
}

function wooAddress(a?: woo.WooAddress): Address | undefined {
  if (!a?.address_1 || !a.city || !a.postcode || !a.country) return undefined;
  const name = [a.first_name, a.last_name].filter(Boolean).join(" ").trim();
  return { name: name || undefined, company: a.company || undefined, street1: a.address_1, street2: a.address_2 || undefined, city: a.city, state: a.state || undefined, zip: a.postcode, country: a.country, phone: a.phone || undefined, email: a.email || undefined };
}

function fromWooOrder(o: woo.WooOrder): IncomingOrder {
  const billingName = [o.billing.first_name, o.billing.last_name].filter(Boolean).join(" ").trim();
  const shippingName = [o.shipping.first_name, o.shipping.last_name].filter(Boolean).join(" ").trim();
  return {
    externalId: String(o.id),
    externalRef: `#${o.number}`,
    customer: shippingName || billingName || o.billing.email || `#${o.number}`,
    customerEmail: o.billing.email || undefined,
    shipTo: wooAddress(o.shipping) ?? wooAddress(o.billing),
    note: o.customer_note || undefined,
    cancelled: ["cancelled", "refunded", "failed", "trash"].includes(o.status),
    lines: o.line_items.map((li) => ({ sku: li.sku ?? undefined, channelKey: String(li.variation_id || li.product_id), qty: li.quantity, unitPrice: Number(li.price) || 0, title: li.name })),
  };
}

function channelKeyOf(item: Item, id: ChannelId): string | undefined {
  if (id === "shopify") return item.channels?.shopify?.variantId;
  const w = item.channels?.woocommerce;
  return w ? (w.variationId ?? w.productId) : undefined;
}

/** Creates the sales order for an incoming channel order unless it is already in. */
async function upsertIncoming(ctx: ServerContext, integration: Integration, incoming: IncomingOrder, items: Item[], existing: Map<string, string>): Promise<"created" | "alreadyIn" | "skippedNoLines" | "cancelled" | "ignored"> {
  const id = integration.id as ChannelId;
  const existingId = existing.get(incoming.externalId);
  if (incoming.cancelled) {
    if (existingId) {
      const order = await ctx.store.get("orders", existingId);
      if (order && (order.status === "open" || order.status === "partial")) {
        await cancelOrder(ctx.store, ctx.actor, existingId);
        return "cancelled";
      }
    }
    return "ignored";
  }
  if (existingId) return "alreadyIn";
  const byKey = new Map<string, Item>();
  const bySku = new Map<string, Item>();
  for (const it of items) {
    const key = channelKeyOf(it, id);
    if (key) byKey.set(key, it);
    bySku.set(it.sku.toUpperCase(), it);
  }
  const lines: Array<{ itemId: string; qty: number; unitPrice: number }> = [];
  const missing: string[] = [];
  for (const l of incoming.lines) {
    if (l.qty <= 0) continue;
    const item = (l.channelKey && byKey.get(l.channelKey)) || (l.sku && bySku.get(l.sku.toUpperCase()));
    if (!item) {
      missing.push(l.sku || l.title);
      continue;
    }
    lines.push({ itemId: item.id, qty: l.qty, unitPrice: l.unitPrice });
  }
  if (lines.length === 0) return "skippedNoLines";
  const note = [incoming.note, missing.length ? `Not in Cumulus, skipped: ${missing.join(", ")}` : ""].filter(Boolean).join("\n") || undefined;
  await createOrder(ctx.store, ctx.actor, { customer: incoming.customer, customerEmail: incoming.customerEmail, shipTo: incoming.shipTo, note, source: id, channel: id, externalId: incoming.externalId, externalRef: incoming.externalRef, lines });
  return "created";
}

async function syncOrders(ctx: ServerContext, integration: Integration, secrets: Secrets): Promise<NonNullable<SyncResult["orders"]>> {
  const id = integration.id as ChannelId;
  const incoming = id === "shopify" ? (await shopify.listOpenOrders(shopifyCreds(integration, secrets))).map(fromShopifyOrder) : (await woo.listOpenOrders(await wooCreds(ctx, integration, secrets))).map(fromWooOrder);
  const items = await ctx.store.list("items");
  const orders = await ctx.store.list("orders");
  const existing = new Map(orders.filter((o) => o.channel === id && o.externalId).map((o) => [o.externalId!, o.id]));
  const result = { seen: incoming.length, created: 0, alreadyIn: 0, skippedNoLines: 0, warnings: [] as string[] };
  for (const o of incoming) {
    try {
      const outcome = await upsertIncoming(ctx, integration, o, items, existing);
      if (outcome === "created") result.created++;
      else if (outcome === "alreadyIn") result.alreadyIn++;
      else if (outcome === "skippedNoLines") {
        result.skippedNoLines++;
        result.warnings.push(`${o.externalRef}: no line matched an item by SKU`);
      }
    } catch (e) {
      result.warnings.push(`${o.externalRef}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}

// ---- entry points ---------------------------------------------------------------

export async function syncChannel(ctx: ServerContext, integration: Integration, secrets: Secrets, what: SyncOptions): Promise<SyncResult> {
  const parts: string[] = [];
  const result: SyncResult = { summary: "" };
  if (what.products) {
    result.products = await syncProducts(ctx, integration, secrets);
    const p = result.products;
    parts.push(`${p.seen} product${p.seen === 1 ? "" : "s"} (${p.created} new, ${p.updated} updated${p.unlinked ? `, ${p.unlinked} gone from the store` : ""}${p.skippedNoSku ? `, ${p.skippedNoSku} without SKU skipped` : ""})`);
  }
  if (what.orders) {
    result.orders = await syncOrders(ctx, integration, secrets);
    const o = result.orders;
    parts.push(`${o.seen} open order${o.seen === 1 ? "" : "s"} (${o.created} new${o.skippedNoLines ? `, ${o.skippedNoLines} unmatched` : ""})`);
  }
  result.summary = parts.join(" · ") || "Nothing selected to sync";
  const patch: Partial<Integration> = { lastSyncAt: nowIso(), lastSyncSummary: result.summary, lastError: undefined, status: "connected" };
  await ctx.store.batch([{ op: "patch", collection: "integrations", id: integration.id, patch }, activityOp(ctx.actor, "integration.synced", `${integration.id === "shopify" ? "Shopify" : "WooCommerce"} sync: ${result.summary}`, { entityType: "integration", entityId: integration.id })]);
  return result;
}

/** Runs `fn` over `list` with at most `limit` in flight, keeping result order. */
async function mapConcurrent<T, R>(list: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      results[i] = await fn(list[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return results;
}

/** Push on-hand counts to the channel for the given items (or every linked item), in as few calls as the platform allows. */
export async function pushStockToChannel(ctx: ServerContext, integration: Integration, secrets: Secrets, itemIds?: string[]): Promise<{ pushed: number; skipped: number; errors: string[] }> {
  const id = integration.id as ChannelId;
  const [allItems, locations] = await Promise.all([ctx.store.list("items"), ctx.store.list("locations")]);
  const items = allItems.filter((i) => (!itemIds || itemIds.includes(i.id)) && !!i.channels?.[id]);
  const homeId = defaultLocation(locations).location.id;
  const locationId = integration.settings?.locationId;
  const qtyFor = (item: Item) => (locationId ? qtyAt(item, locationId, homeId) : item.onHand);
  const out = { pushed: 0, skipped: 0, errors: [] as string[] };
  if (items.length === 0) return out;
  if (id === "shopify") {
    const creds = shopifyCreds(integration, secrets);
    let channelLocationId = integration.settings?.channelLocationId;
    if (!channelLocationId) {
      const shop = await shopify.verifyShop(creds);
      channelLocationId = shop.primaryLocationId ?? (await shopify.listLocations(creds)).find((l) => l.active)?.id;
      if (!channelLocationId) throw new HttpError(409, "Shopify has no active location to push stock to.");
      await ctx.store.patch("integrations", id, { settings: { ...(integration.settings ?? {}), channelLocationId } });
    }
    const entries = items.filter((i) => i.channels!.shopify!.inventoryItemId).map((i) => ({ inventoryItemId: i.channels!.shopify!.inventoryItemId!, quantity: qtyFor(i) }));
    out.skipped = items.length - entries.length;
    try {
      await shopify.setInventoryQuantities(creds, channelLocationId, entries);
      out.pushed = entries.length;
    } catch (e) {
      out.errors.push(e instanceof Error ? e.message : String(e));
    }
  } else {
    const creds = await wooCreds(ctx, integration, secrets);
    try {
      await woo.batchUpdateStock(creds, items.map((i) => ({ ...i.channels!.woocommerce!, qty: qtyFor(i) })));
      out.pushed = items.length;
    } catch (e) {
      out.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return out;
}

/**
 * Creates active items that the channel does not have yet as draft products
 * there, links them, and sets their stock. Items already linked are left to
 * the stock push; a product that exists in the store but was never linked is
 * matched by SKU first so nothing is duplicated.
 */
export async function pushProductsToChannel(ctx: ServerContext, integration: Integration, secrets: Secrets, itemIds?: string[]): Promise<{ created: number; linked: number; skipped: number; errors: string[] }> {
  const id = integration.id as ChannelId;
  const items = (await ctx.store.list("items")).filter((i) => (!itemIds || itemIds.includes(i.id)) && i.status === "active" && !i.channels?.[id] && i.sku.trim());
  const out = { created: 0, linked: 0, skipped: 0, errors: [] as string[] };
  if (items.length === 0) return out;
  const locations = await ctx.store.list("locations");
  const homeId = defaultLocation(locations).location.id;
  const locationId = integration.settings?.locationId;
  const qtyFor = (item: Item) => Math.max(0, locationId ? qtyAt(item, locationId, homeId) : item.onHand);
  const publish = integration.settings?.publishProducts === true;
  const ops: WriteOp[] = [];

  const skus = items.map((i) => i.sku.trim());
  if (id === "shopify") {
    const creds = shopifyCreds(integration, secrets);
    // Existing store products that simply were never linked: match by SKU rather than creating twins.
    const existing = await shopify.findVariantsBySku(creds, skus);
    const stockEntries: Array<{ inventoryItemId: string; quantity: number }> = [];
    await mapConcurrent(items, 4, async (item) => {
      try {
        let ref = existing.get(item.sku.toUpperCase());
        if (ref) out.linked++;
        else {
          ref = await shopify.createProduct(creds, { title: item.name, sku: item.sku, price: item.price, description: item.description, vendor: item.brand, productType: item.category, tags: item.tags, barcode: item.barcode, weight: item.weight, weightUnit: item.weightUnit, publish });
          out.created++;
          if (ref.inventoryItemId && qtyFor(item) > 0) stockEntries.push({ inventoryItemId: ref.inventoryItemId, quantity: qtyFor(item) });
        }
        ops.push({ op: "patch", collection: "items", id: item.id, patch: { channels: { ...(item.channels ?? {}), shopify: ref } } });
      } catch (e) {
        out.errors.push(`${item.sku}: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    const channelLocationId = integration.settings?.channelLocationId;
    if (stockEntries.length && channelLocationId) {
      try {
        await shopify.setInventoryQuantities(creds, channelLocationId, stockEntries);
      } catch (e) {
        out.errors.push(`Stock on new products: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } else {
    const creds = await wooCreds(ctx, integration, secrets);
    const existing = await woo.findProductsBySku(creds, skus);
    await mapConcurrent(items, 4, async (item) => {
      try {
        let ref = existing.get(item.sku.toUpperCase());
        if (ref) out.linked++;
        else {
          const created = await woo.createProduct(creds, { name: item.name, sku: item.sku, price: item.price, description: item.description, stockQuantity: qtyFor(item), weight: item.weight, dimensions: item.dimensions, barcode: item.barcode, publish });
          ref = { productId: created.id };
          out.created++;
        }
        ops.push({ op: "patch", collection: "items", id: item.id, patch: { channels: { ...(item.channels ?? {}), woocommerce: ref } } });
      } catch (e) {
        out.errors.push(`${item.sku}: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
  }
  if (ops.length) await ctx.store.batch(ops);
  return out;
}

/** Applies one webhook delivery. Returns a one-line description for logs. */
export async function handleChannelWebhook(ctx: ServerContext, integration: Integration, secrets: Secrets, topic: string, payload: unknown): Promise<string> {
  const id = integration.id as ChannelId;
  const settings = integration.settings ?? {};
  const body = (payload ?? {}) as Record<string, unknown>;

  if (id === "shopify") {
    if (topic.startsWith("orders/")) {
      if (!settings.syncOrders) return "orders sync is off";
      const incoming = fromShopifyOrder(body as unknown as shopify.ShopifyOrder);
      if (!incoming.cancelled && (body.fulfillment_status === "fulfilled" || ["voided", "refunded"].includes(String(body.financial_status)))) return `${incoming.externalRef} ignored (${body.fulfillment_status ?? body.financial_status})`;
      return `${incoming.externalRef}: ${await applyIncoming(ctx, integration, incoming)}`;
    }
    if (topic === "products/delete") {
      const productId = String(body.id ?? "");
      if (!productId) return "ignored";
      return productDeletedInStore(ctx, integration, (i) => i.channels?.shopify?.productId === productId);
    }
    if (topic === "products/update") {
      if (!settings.syncProducts) return "products sync is off";
      const { rows } = shopifyRows([body as unknown as shopify.ShopifyProduct]);
      return productUpdatedInStore(ctx, integration, rows);
    }
    if (topic === "inventory_levels/update") {
      if (!settings.acceptStockFromChannel) return "stock from channel is off";
      const inventoryItemId = String(body.inventory_item_id ?? "");
      const available = Number(body.available);
      if (!inventoryItemId || !Number.isFinite(available)) return "ignored";
      if (settings.channelLocationId && String(body.location_id ?? "") !== settings.channelLocationId) return "other location";
      const item = (await ctx.store.list("items")).find((i) => i.channels?.shopify?.inventoryItemId === inventoryItemId);
      if (!item) return "no linked item";
      return await countFromChannel(ctx, integration, item, available);
    }
    return `unhandled topic ${topic}`;
  }

  if (topic.startsWith("order.")) {
    if (!settings.syncOrders) return "orders sync is off";
    if (typeof body.id !== "number" && typeof body.id !== "string") return "no order in payload";
    const incoming = fromWooOrder(body as unknown as woo.WooOrder);
    const status = String(body.status ?? "");
    if (!incoming.cancelled && !["processing", "on-hold"].includes(status)) return `${incoming.externalRef} ignored (${status})`;
    return `${incoming.externalRef}: ${await applyIncoming(ctx, integration, incoming)}`;
  }
  if (topic === "product.deleted") {
    const productId = String(body.id ?? "");
    if (!productId) return "ignored";
    return productDeletedInStore(ctx, integration, (i) => i.channels?.woocommerce?.productId === productId);
  }
  if (topic === "product.updated") {
    const productId = String(body.id ?? "");
    if (!productId) return "ignored";
    const notes: string[] = [];
    if (String(body.status ?? "") === "trash") return productDeletedInStore(ctx, integration, (i) => i.channels?.woocommerce?.productId === productId);
    if (settings.syncProducts) {
      const { rows } = wooRows([{ product: body as unknown as woo.WooProduct }], integration.config?.weightUnit);
      if (rows.length) notes.push(await productUpdatedInStore(ctx, integration, rows));
    }
    if (settings.acceptStockFromChannel) {
      const qty = body.manage_stock ? Number(body.stock_quantity) : NaN;
      const item = (await ctx.store.list("items")).find((i) => i.channels?.woocommerce?.productId === productId && !i.channels?.woocommerce?.variationId);
      if (item && Number.isFinite(qty)) notes.push(await countFromChannel(ctx, integration, item, qty));
    }
    return notes.join(" · ") || "nothing to apply";
  }
  return `unhandled topic ${topic}`;
}

export interface RunOptions {
  products?: boolean;
  orders?: boolean;
  pushProducts?: boolean;
  pushDetails?: boolean;
  pushStock?: boolean;
  /** Limit the outbound pushes to these items. */
  itemIds?: string[];
  /** Items whose details (name, price, description…) changed; defaults to "changed since the last push" when nothing is given. */
  detailIds?: string[];
}

export interface RunResult {
  summary: string;
  removed: number;
  products?: SyncResult["products"];
  orders?: SyncResult["orders"];
  created?: number;
  linked?: number;
  detailsUpdated?: number;
  stockPushed?: number;
  errors: string[];
}

/** The whole two-way pass in the right order: deletes out, products and orders in, new items out, edits out, stock out. */
export async function runChannelSync(ctx: ServerContext, integration: Integration, secrets: Secrets, opts: RunOptions): Promise<RunResult> {
  const s = integration.settings ?? {};
  const errors: string[] = [];
  const parts: string[] = [];
  const tomb = await processTombstones(ctx, integration, secrets);
  errors.push(...tomb.errors);
  if (tomb.removed) parts.push(`${tomb.removed} removed from the store`);
  const result: RunResult = { summary: "", removed: tomb.removed, errors };
  const doProducts = opts.products ?? s.syncProducts !== false;
  const doOrders = opts.orders ?? s.syncOrders !== false;
  if ((doProducts || doOrders) && !opts.itemIds) {
    const sync = await syncChannel(ctx, integration, secrets, { products: doProducts, orders: doOrders });
    result.products = sync.products;
    result.orders = sync.orders;
    parts.push(sync.summary);
    errors.push(...(sync.orders?.warnings ?? []));
  }
  if (opts.pushProducts ?? s.pushProducts) {
    const p = await pushProductsToChannel(ctx, integration, secrets, opts.itemIds);
    result.created = p.created;
    result.linked = p.linked;
    errors.push(...p.errors);
    if (p.created || p.linked) parts.push(`${p.created} new ${s.publishProducts ? "live" : "draft"} product${p.created === 1 ? "" : "s"} pushed${p.linked ? `, ${p.linked} linked by SKU` : ""}`);
  }
  if (opts.pushDetails ?? s.pushDetails) {
    const d = await pushItemDetails(ctx, integration, secrets, opts.detailIds ?? (opts.itemIds ? [] : undefined));
    result.detailsUpdated = d.updated;
    errors.push(...d.errors);
    if (d.updated) parts.push(`${d.updated} product${d.updated === 1 ? "" : "s"} updated in the store`);
  }
  if (opts.pushStock ?? s.pushStock) {
    const st = await pushStockToChannel(ctx, integration, secrets, opts.itemIds);
    result.stockPushed = st.pushed;
    errors.push(...st.errors);
    if (st.pushed) parts.push(`${st.pushed} stock level${st.pushed === 1 ? "" : "s"} pushed`);
  }
  result.summary = parts.join(" · ") || "Nothing to do";
  const patch: Partial<Integration> = { lastError: errors.length ? errors.slice(0, 3).join("; ") : undefined };
  if (!opts.itemIds) patch.lastSyncSummary = result.summary;
  await ctx.store.patch("integrations", integration.id, patch);
  return result;
}

async function applyIncoming(ctx: ServerContext, integration: Integration, incoming: IncomingOrder): Promise<string> {
  const items = await ctx.store.list("items");
  const orders = await ctx.store.list("orders");
  const existing = new Map(orders.filter((o) => o.channel === integration.id && o.externalId).map((o) => [o.externalId!, o.id]));
  return upsertIncoming(ctx, integration, incoming, items, existing);
}

async function countFromChannel(ctx: ServerContext, integration: Integration, item: Item, qty: number): Promise<string> {
  const locations = await ctx.store.list("locations");
  const homeId = defaultLocation(locations).location.id;
  const locationId = integration.settings?.locationId ?? homeId;
  const current = qtyAt(item, locationId, homeId);
  if (current === qty) return `${item.sku} already ${qty}`;
  await adjustStock(ctx.store, ctx.actor, [{ itemId: item.id, newQty: qty, locationId, reason: `Count from ${integration.id === "shopify" ? "Shopify" : "WooCommerce"}` }]);
  return `${item.sku} counted ${current} → ${qty}`;
}

export type { ItemStock };
