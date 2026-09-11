import { createHmac } from "node:crypto";
import { HttpError, expectArray, fetchJson, safeEqual } from "./server";

/** Shopify Admin REST API client. Needs a custom app's Admin API access token. */

export const SHOPIFY_API_VERSION = "2025-01";

export interface ShopifyCreds {
  /** your-store.myshopify.com */
  shop: string;
  accessToken: string;
}

export interface ShopifyVariant {
  id: number;
  product_id: number;
  title: string;
  sku: string | null;
  price: string;
  barcode: string | null;
  inventory_item_id: number;
  inventory_quantity: number;
  inventory_management: string | null;
  weight: number;
  weight_unit: string;
}

export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  status: "active" | "archived" | "draft";
  vendor: string;
  product_type: string;
  tags: string;
  variants: ShopifyVariant[];
  image?: { src: string } | null;
}

export interface ShopifyAddress {
  name?: string;
  company?: string | null;
  address1?: string;
  address2?: string | null;
  city?: string;
  province_code?: string | null;
  zip?: string;
  country_code?: string;
  phone?: string | null;
}

export interface ShopifyOrder {
  id: number;
  name: string;
  email: string | null;
  created_at: string;
  cancelled_at: string | null;
  financial_status: string;
  fulfillment_status: string | null;
  note: string | null;
  customer?: { first_name?: string | null; last_name?: string | null; email?: string | null } | null;
  shipping_address?: ShopifyAddress | null;
  billing_address?: ShopifyAddress | null;
  line_items: Array<{ id: number; variant_id: number | null; product_id: number | null; sku: string | null; title: string; quantity: number; fulfillable_quantity: number; price: string }>;
}

export function normalizeShop(input: string): string {
  let shop = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!shop) throw new HttpError(400, "Enter the store's .myshopify.com address.");
  if (!shop.includes(".")) shop = `${shop}.myshopify.com`;
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(shop)) throw new HttpError(400, "The store address should look like your-store.myshopify.com.");
  return shop;
}

async function request<T>(creds: ShopifyCreds, path: string, init: { method?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<{ data: T; headers: Headers }> {
  const url = new URL(`https://${creds.shop}/admin/api/${SHOPIFY_API_VERSION}/${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
  const res = await fetchJson<T>(url.toString(), {
    method: init.method ?? "GET",
    headers: { "X-Shopify-Access-Token": creds.accessToken, "Content-Type": "application/json", Accept: "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { data: res.data, headers: res.headers };
}

/** Follows Shopify's cursor pagination (Link: <…page_info=…>; rel="next"). */
async function paginate<T>(creds: ShopifyCreds, path: string, key: string, query: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  let pageInfo: string | undefined;
  for (let page = 0; page < 200; page++) {
    const q: Record<string, string> = pageInfo ? { limit: query.limit ?? "250", page_info: pageInfo } : { ...query, limit: query.limit ?? "250" };
    const { data, headers } = await request<Record<string, unknown>>(creds, path, { query: q });
    for (const row of expectArray<T>(data?.[key] ?? [], key, creds.shop)) out.push(row);
    const link = headers.get("link") ?? "";
    const next = /<[^>]*[?&]page_info=([^&>]+)[^>]*>;\s*rel="next"/.exec(link);
    if (!next) break;
    pageInfo = decodeURIComponent(next[1]!);
  }
  return out;
}

export async function verifyShop(creds: ShopifyCreds): Promise<{ name: string; domain: string; currency: string; primaryLocationId?: string }> {
  const { data } = await request<{ shop: { name: string; domain: string; myshopify_domain: string; currency: string; primary_location_id?: number } }>(creds, "shop.json");
  return { name: data.shop.name, domain: data.shop.domain || data.shop.myshopify_domain, currency: data.shop.currency, primaryLocationId: data.shop.primary_location_id ? String(data.shop.primary_location_id) : undefined };
}

export async function listLocations(creds: ShopifyCreds): Promise<Array<{ id: string; name: string; active: boolean }>> {
  const { data } = await request<{ locations: Array<{ id: number; name: string; active: boolean }> }>(creds, "locations.json");
  return data.locations.map((l) => ({ id: String(l.id), name: l.name, active: l.active }));
}

export function listProducts(creds: ShopifyCreds): Promise<ShopifyProduct[]> {
  return paginate<ShopifyProduct>(creds, "products.json", "products", { status: "active,draft,archived", fields: "id,title,handle,status,vendor,product_type,tags,variants,image" });
}

/** Open, unshipped orders. Cancelled and refunded ones are filtered out. */
export async function listOpenOrders(creds: ShopifyCreds): Promise<ShopifyOrder[]> {
  const orders = await paginate<ShopifyOrder>(creds, "orders.json", "orders", { status: "open", fulfillment_status: "unshipped" });
  return orders.filter((o) => !o.cancelled_at && !["voided", "refunded"].includes(o.financial_status));
}

export async function getOrder(creds: ShopifyCreds, id: string): Promise<ShopifyOrder> {
  const { data } = await request<{ order: ShopifyOrder }>(creds, `orders/${id}.json`);
  return data.order;
}

export interface NewShopifyProduct {
  title: string;
  sku: string;
  price?: number;
  description?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  barcode?: string;
  weight?: number;
  weightUnit?: string;
}

/** Creates a single-variant product as a draft; stock is set afterwards through inventory levels. */
export async function createProduct(creds: ShopifyCreds, p: NewShopifyProduct): Promise<{ productId: string; variantId: string; inventoryItemId?: string }> {
  const variant: Record<string, unknown> = { sku: p.sku, inventory_management: "shopify", inventory_policy: "deny" };
  if (p.price !== undefined && p.price > 0) variant.price = p.price.toFixed(2);
  if (p.barcode) variant.barcode = p.barcode;
  if (p.weight) {
    variant.weight = p.weight;
    if (p.weightUnit && ["g", "kg", "oz", "lb"].includes(p.weightUnit)) variant.weight_unit = p.weightUnit;
  }
  const product: Record<string, unknown> = { title: p.title, status: "draft", variants: [variant] };
  if (p.description) product.body_html = p.description;
  if (p.vendor) product.vendor = p.vendor;
  if (p.productType) product.product_type = p.productType;
  if (p.tags?.length) product.tags = p.tags.join(", ");
  const { data } = await request<{ product?: { id?: number; variants?: Array<{ id?: number; inventory_item_id?: number }> } }>(creds, "products.json", { method: "POST", body: { product } });
  const created = data?.product;
  const v = created?.variants?.[0];
  if (typeof created?.id !== "number" || typeof v?.id !== "number") throw new HttpError(502, `${creds.shop} did not confirm the new product ${p.sku}.`);
  return { productId: String(created.id), variantId: String(v.id), inventoryItemId: v.inventory_item_id ? String(v.inventory_item_id) : undefined };
}

export async function setInventoryLevel(creds: ShopifyCreds, inventoryItemId: string, locationId: string, available: number): Promise<void> {
  await request(creds, "inventory_levels/set.json", { method: "POST", body: { location_id: Number(locationId), inventory_item_id: Number(inventoryItemId), available: Math.max(0, Math.round(available)) } });
}

export async function createWebhook(creds: ShopifyCreds, topic: string, address: string): Promise<string> {
  const { data } = await request<{ webhook?: { id?: number } }>(creds, "webhooks.json", { method: "POST", body: { webhook: { topic, address, format: "json" } } });
  if (typeof data?.webhook?.id !== "number") throw new HttpError(502, `${creds.shop} did not confirm the ${topic} webhook.`);
  return String(data.webhook.id);
}

export async function deleteWebhook(creds: ShopifyCreds, id: string): Promise<void> {
  await request(creds, `webhooks/${id}.json`, { method: "DELETE" });
}

/** Shopify signs webhook bodies with the app's API secret key (HMAC-SHA256, base64). */
export function verifyShopifyWebhook(rawBody: string, hmacHeader: string | null, apiSecret: string): boolean {
  if (!hmacHeader) return false;
  const digest = createHmac("sha256", apiSecret).update(rawBody, "utf8").digest("base64");
  return safeEqual(digest, hmacHeader);
}
