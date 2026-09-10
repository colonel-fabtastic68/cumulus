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
  products?: { seen: number; created: number; updated: number; skippedNoSku: number };
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
  if (integration.config?.plainPermalinks === undefined) {
    plainPermalinks = (await woo.detectPermalinks(siteUrl)).plainPermalinks;
    const config = { ...(integration.config ?? {}), plainPermalinks: plainPermalinks ? "1" : "0" };
    integration.config = config;
    await ctx.store.patch("integrations", integration.id, { config });
  }
  return { siteUrl, consumerKey: secrets.consumerKey, consumerSecret: secrets.consumerSecret, plainPermalinks };
}

// ---- products ------------------------------------------------------------------

interface ChannelRow {
  row: ImportRow;
  ref: NonNullable<Item["channels"]>;
  weightUnit?: string;
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
    });
  }
  return { rows, skippedNoSku };
}

async function syncProducts(ctx: ServerContext, integration: Integration, secrets: Secrets): Promise<NonNullable<SyncResult["products"]>> {
  const id = integration.id as ChannelId;
  const { rows, skippedNoSku } = id === "shopify" ? shopifyRows(await shopify.listProducts(shopifyCreds(integration, secrets))) : wooRows(await woo.listProducts(await wooCreds(ctx, integration, secrets)), integration.config?.weightUnit);
  const firstSync = !integration.lastSyncAt;
  const takeStock = firstSync && integration.settings?.takeStockOnFirstSync === true;
  const result = await importItems(ctx.store, ctx.actor, rows.map((r) => (takeStock ? r.row : { ...r.row, qty: undefined })), { setQuantities: takeStock });
  // Remember which channel record each item mirrors, so orders and stock pushes match by id, not just SKU.
  const items = await ctx.store.list("items");
  const bySku = new Map(items.map((i) => [i.sku.toUpperCase(), i]));
  const ops: WriteOp[] = [];
  for (const r of rows) {
    const item = bySku.get(r.row.sku.toUpperCase());
    if (!item) continue;
    const patch: Partial<Item> = { channels: { ...(item.channels ?? {}), ...r.ref } };
    if (r.weightUnit && r.row.weight && item.weightUnit !== r.weightUnit) patch.weightUnit = r.weightUnit;
    ops.push({ op: "patch", collection: "items", id: item.id, patch });
  }
  if (ops.length) await ctx.store.batch(ops);
  return { seen: rows.length + skippedNoSku, created: result.created, updated: result.updated, skippedNoSku };
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
    parts.push(`${p.seen} product${p.seen === 1 ? "" : "s"} (${p.created} new, ${p.updated} updated${p.skippedNoSku ? `, ${p.skippedNoSku} without SKU skipped` : ""})`);
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

/** Push on-hand counts to the channel for the given items (or every linked item). */
export async function pushStockToChannel(ctx: ServerContext, integration: Integration, secrets: Secrets, itemIds?: string[]): Promise<{ pushed: number; skipped: number; errors: string[] }> {
  const id = integration.id as ChannelId;
  const items = (await ctx.store.list("items")).filter((i) => (!itemIds || itemIds.includes(i.id)) && !!i.channels?.[id]);
  const locations = await ctx.store.list("locations");
  const homeId = defaultLocation(locations).location.id;
  const locationId = integration.settings?.locationId;
  const qtyFor = (item: Item) => (locationId ? qtyAt(item, locationId, homeId) : item.onHand);
  const out = { pushed: 0, skipped: 0, errors: [] as string[] };
  if (id === "shopify") {
    const creds = shopifyCreds(integration, secrets);
    let channelLocationId = integration.settings?.channelLocationId;
    if (!channelLocationId) {
      const shop = await shopify.verifyShop(creds);
      channelLocationId = shop.primaryLocationId ?? (await shopify.listLocations(creds)).find((l) => l.active)?.id;
      if (!channelLocationId) throw new HttpError(409, "Shopify has no active location to push stock to.");
      await ctx.store.patch("integrations", id, { settings: { ...(integration.settings ?? {}), channelLocationId } });
    }
    for (const item of items) {
      const ref = item.channels!.shopify!;
      if (!ref.inventoryItemId) {
        out.skipped++;
        continue;
      }
      try {
        await shopify.setInventoryLevel(creds, ref.inventoryItemId, channelLocationId, qtyFor(item));
        out.pushed++;
      } catch (e) {
        out.errors.push(`${item.sku}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } else {
    const creds = await wooCreds(ctx, integration, secrets);
    for (const item of items) {
      const ref = item.channels!.woocommerce!;
      try {
        await woo.updateStock(creds, ref.productId, ref.variationId, qtyFor(item));
        out.pushed++;
      } catch (e) {
        out.errors.push(`${item.sku}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
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
  if (topic === "product.updated") {
    if (!settings.acceptStockFromChannel) return "stock from channel is off";
    const productId = String(body.id ?? "");
    const qty = body.manage_stock ? Number(body.stock_quantity) : NaN;
    if (!productId || !Number.isFinite(qty)) return "ignored";
    const item = (await ctx.store.list("items")).find((i) => i.channels?.woocommerce?.productId === productId && !i.channels?.woocommerce?.variationId);
    if (!item) return "no linked item";
    return await countFromChannel(ctx, integration, item, qty);
  }
  return `unhandled topic ${topic}`;
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
