import { createHmac } from "node:crypto";
import { HttpError, expectArray, fetchJson, safeEqual } from "./server";

/** WooCommerce REST API v3 client. Needs a REST API key pair (WooCommerce → Settings → Advanced → REST API). */

export interface WooCreds {
  siteUrl: string;
  consumerKey: string;
  consumerSecret: string;
  /** Sites with "Plain" permalinks only expose the API as ?rest_route=…, not /wp-json/…. */
  plainPermalinks?: boolean;
}

export interface WooProduct {
  id: number;
  name: string;
  sku: string;
  type: "simple" | "variable" | "grouped" | "external" | string;
  status: "publish" | "draft" | "pending" | "private" | string;
  price: string;
  regular_price: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  low_stock_amount?: number | null;
  weight: string;
  dimensions?: { length: string; width: string; height: string };
  categories?: Array<{ id: number; name: string }>;
  tags?: Array<{ id: number; name: string }>;
  images?: Array<{ src: string }>;
  global_unique_id?: string;
  attributes?: Array<{ name: string; option?: string; options?: string[] }>;
}

export interface WooVariation extends WooProduct {
  parent_id?: number;
  image?: { src: string } | null;
}

export interface WooAddress {
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  email?: string;
  phone?: string;
}

export interface WooOrder {
  id: number;
  number: string;
  status: string;
  date_created: string;
  customer_note?: string;
  billing: WooAddress;
  shipping: WooAddress;
  line_items: Array<{ id: number; product_id: number; variation_id: number; sku: string | null; name: string; quantity: number; price: number | string }>;
}

export function normalizeSiteUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, "");
  if (!url) throw new HttpError(400, "Enter the site URL.");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(400, "The site URL does not look right.");
  }
  if (parsed.protocol !== "https:") throw new HttpError(400, "The site must use https so the API keys are not sent in the clear.");
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

/** Builds the endpoint for either permalink style. */
export function endpoint(creds: Pick<WooCreds, "siteUrl" | "plainPermalinks">, path: string, query: Record<string, string> = {}): URL {
  let url: URL;
  if (creds.plainPermalinks) {
    url = new URL(`${creds.siteUrl}/`);
    url.searchParams.set("rest_route", `/wc/v3/${path}`);
  } else {
    url = new URL(`${creds.siteUrl}/wp-json/wc/v3/${path}`);
  }
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return url;
}

/**
 * Works out how the site exposes its REST API. WordPress only serves /wp-json/
 * with pretty permalinks; on "Plain" permalinks the same routes live under
 * ?rest_route=. Either way an unauthenticated call answers with JSON (an
 * error or data), while a blocked API answers with a web page or a redirect.
 */
export async function detectPermalinks(siteUrl: string): Promise<{ plainPermalinks: boolean }> {
  const attempts: Array<{ plain: boolean; problem?: string }> = [];
  for (const plain of [false, true]) {
    const url = endpoint({ siteUrl, plainPermalinks: plain }, "system_status", {});
    try {
      await fetchJson<unknown>(url.toString(), { method: "GET", redirect: "manual", timeoutMs: 15_000 });
      return { plainPermalinks: plain };
    } catch (e) {
      // 401/403 with a JSON body means the API is there and just wants credentials.
      if (e instanceof HttpError && e.status === 401) return { plainPermalinks: plain };
      attempts.push({ plain, problem: e instanceof Error ? e.message : String(e) });
    }
  }
  throw new HttpError(502, `The WordPress REST API does not answer at ${new URL(siteUrl).host}: ${attempts.map((a) => `${a.plain ? "?rest_route=" : "/wp-json/"} → ${a.problem}`).join("; ")}. Check that the site is live (not a "coming soon" or password-protected page), that no security plugin disables the REST API, and that WooCommerce is active.`);
}

async function request<T>(creds: WooCreds, path: string, init: { method?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<{ data: T; headers: Headers }> {
  const url = endpoint(creds, path, init.query);
  const auth = Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString("base64");
  const res = await fetchJson<T>(url.toString(), {
    method: init.method ?? "GET",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", Accept: "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { data: res.data, headers: res.headers };
}

async function paginate<T>(creds: WooCreds, path: string, query: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= 200; page++) {
    const { data: raw, headers } = await request<unknown>(creds, path, { query: { ...query, per_page: "100", page: String(page) } });
    const data = expectArray<T>(raw, path.replace(/^products\/\d+\//, ""), new URL(creds.siteUrl).host);
    for (const row of data) out.push(row);
    const totalPages = Number(headers.get("x-wp-totalpages") ?? "1");
    if (page >= totalPages || data.length === 0) break;
  }
  return out;
}

export async function verifySite(creds: WooCreds): Promise<{ name?: string; currency?: string; weightUnit?: string; version?: string }> {
  // system_status needs a read key; it also reveals the store's units, which stock and weight sync rely on.
  try {
    const { data } = await request<{ environment?: { site_url?: string; version?: string }; settings?: { currency?: string } }>(creds, "system_status");
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new HttpError(502, `${new URL(creds.siteUrl).host} did not answer the system status call as expected.`);
    let weightUnit: string | undefined;
    try {
      const unit = await request<{ value?: string }>(creds, "settings/products/woocommerce_weight_unit");
      weightUnit = unit.data.value;
    } catch {
      weightUnit = undefined;
    }
    return { name: data.environment?.site_url, version: data.environment?.version, currency: data.settings?.currency, weightUnit };
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) throw e;
    // A read-only key may not see system_status; a product listing proves the keys work.
    const probe = await request<unknown>(creds, "products", { query: { per_page: "1" } });
    expectArray(probe.data, "products", new URL(creds.siteUrl).host);
    return {};
  }
}

export async function listProducts(creds: WooCreds): Promise<Array<{ product: WooProduct; variation?: WooVariation }>> {
  const products = await paginate<WooProduct>(creds, "products", { status: "any" });
  const out: Array<{ product: WooProduct; variation?: WooVariation }> = [];
  for (const product of products) {
    if (product.type === "variable") {
      const variations = await paginate<WooVariation>(creds, `products/${product.id}/variations`, { status: "any" });
      for (const variation of variations) out.push({ product, variation });
    } else {
      out.push({ product });
    }
  }
  return out;
}

/** Paid orders waiting to ship. */
export function listOpenOrders(creds: WooCreds): Promise<WooOrder[]> {
  return paginate<WooOrder>(creds, "orders", { status: "processing,on-hold" });
}

export async function getOrder(creds: WooCreds, id: string): Promise<WooOrder> {
  const { data } = await request<WooOrder>(creds, `orders/${id}`);
  return data;
}

export async function updateStock(creds: WooCreds, productId: string, variationId: string | undefined, qty: number): Promise<void> {
  const path = variationId ? `products/${productId}/variations/${variationId}` : `products/${productId}`;
  await request(creds, path, { method: "PUT", body: { manage_stock: true, stock_quantity: Math.max(0, Math.round(qty)) } });
}

export async function createWebhook(creds: WooCreds, topic: string, deliveryUrl: string, secret: string): Promise<string> {
  const { data } = await request<{ id?: number }>(creds, "webhooks", { method: "POST", body: { name: `Cumulus ${topic}`, topic, delivery_url: deliveryUrl, secret, status: "active" } });
  if (!data || typeof data.id !== "number") throw new HttpError(502, `${new URL(creds.siteUrl).host} did not confirm the ${topic} webhook.`);
  return String(data.id);
}

export async function deleteWebhook(creds: WooCreds, id: string): Promise<void> {
  await request(creds, `webhooks/${id}`, { method: "DELETE", query: { force: "true" } });
}

/** WooCommerce signs deliveries with the webhook secret (HMAC-SHA256, base64) in X-WC-Webhook-Signature. */
export function verifyWooWebhook(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return safeEqual(digest, signature);
}
