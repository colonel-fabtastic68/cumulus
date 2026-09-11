import { createHmac, randomBytes } from "node:crypto";
import { HttpError, expectArray, fetchJson, safeEqual } from "./server";

/** WooCommerce REST API v3 client. Needs a REST API key pair (WooCommerce → Settings → Advanced → REST API). */

/**
 * How the keys travel. "basic" is the documented HTTPS method; WooCommerce
 * ignores it when WordPress cannot tell it is behind HTTPS (is_ssl() false
 * behind some proxies), and then only signed OAuth 1.0a requests work. The
 * signature base URL must use the scheme WordPress believes it is on, hence
 * the http variant.
 */
export type WooAuthMode = "basic" | "oauth" | "oauth-http";

export interface WooCreds {
  siteUrl: string;
  consumerKey: string;
  consumerSecret: string;
  /** Sites with "Plain" permalinks only expose the API as ?rest_route=…, not /wp-json/…. */
  plainPermalinks?: boolean;
  authMode?: WooAuthMode;
}

const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** Adds one-legged OAuth 1.0a parameters (HMAC-SHA256) to the request URL, the way WooCommerce verifies them. */
export function signOAuth(url: URL, method: string, creds: Pick<WooCreds, "consumerKey" | "consumerSecret">, scheme: "https" | "http"): URL {
  const signed = new URL(url.toString());
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
  };
  for (const [k, v] of Object.entries(oauth)) signed.searchParams.set(k, v);
  const pairs = Array.from(signed.searchParams.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`);
  const baseUrl = `${scheme}://${signed.host}${signed.pathname}`;
  const base = `${method.toUpperCase()}&${rfc3986(baseUrl)}&${rfc3986(pairs.join("&"))}`;
  const signature = createHmac("sha256", `${creds.consumerSecret}&`).update(base).digest("base64");
  signed.searchParams.set("oauth_signature", signature);
  return signed;
}

export interface WooProduct {
  id: number;
  name: string;
  sku: string;
  date_modified_gmt?: string;
  description?: string;
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
    // A cache-busting parameter so a host's page cache cannot replay an answer from before a permalink change.
    const url = endpoint({ siteUrl, plainPermalinks: plain }, "system_status", { _cb: randomBytes(4).toString("hex") });
    try {
      await fetchJson<unknown>(url.toString(), { method: "GET", redirect: "manual", timeoutMs: 15_000, headers: { "Cache-Control": "no-cache" } });
      return { plainPermalinks: plain };
    } catch (e) {
      // 401/403 with a JSON body means the API is there and just wants credentials.
      if (e instanceof HttpError && e.status === 401) return { plainPermalinks: plain };
      attempts.push({ plain, problem: e instanceof Error ? e.message : String(e) });
    }
  }
  throw new HttpError(502, `The WordPress REST API does not answer at ${new URL(siteUrl).host}: ${attempts.map((a) => `${a.plain ? "?rest_route=" : "/wp-json/"} → ${a.problem}`).join("; ")}. Check that the site is live (not a "coming soon" or password-protected page), that no security plugin disables the REST API, and that WooCommerce is active.`);
}

export const PLAIN_PERMALINKS_HELP = 'WooCommerce only checks API keys on /wp-json/ addresses, and this site is set to "Plain" permalinks, so every key is treated as anonymous. In WordPress open Settings → Permalinks, choose "Post name", save, then connect again.';

/** Turns a 401 from a site on plain permalinks into the instruction that actually fixes it. */
function explainAuthFailure(e: unknown, creds: Pick<WooCreds, "plainPermalinks">): unknown {
  if (creds.plainPermalinks && e instanceof HttpError && e.status === 401) return new HttpError(409, PLAIN_PERMALINKS_HELP);
  return e;
}

async function request<T>(creds: WooCreds, path: string, init: { method?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<{ data: T; headers: Headers }> {
  try {
    return await requestOnce<T>(creds, path, init);
  } catch (e) {
    throw explainAuthFailure(e, creds);
  }
}

async function requestOnce<T>(creds: WooCreds, path: string, init: { method?: string; body?: unknown; query?: Record<string, string> } = {}): Promise<{ data: T; headers: Headers }> {
  const method = init.method ?? "GET";
  let url = endpoint(creds, path, init.query);
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json", "Cache-Control": "no-cache" };
  if (creds.authMode === "oauth" || creds.authMode === "oauth-http") {
    url = signOAuth(url, method, creds, creds.authMode === "oauth-http" ? "http" : "https");
  } else {
    headers.Authorization = `Basic ${Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString("base64")}`;
  }
  const res = await fetchJson<T>(url.toString(), { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  return { data: res.data, headers: res.headers };
}

/**
 * Finds a way of sending the keys that this site accepts: the Basic header
 * first, then OAuth signed for https, then OAuth signed for http (what
 * WordPress computes when a proxy hides the TLS from it). A key that is
 * genuinely wrong fails every mode with "Consumer key is invalid".
 */
export async function detectAuthMode(creds: Omit<WooCreds, "authMode">): Promise<WooAuthMode> {
  const modes: WooAuthMode[] = ["basic", "oauth", "oauth-http"];
  let lastError: unknown = null;
  for (const authMode of modes) {
    try {
      const { data } = await requestOnce<unknown>({ ...creds, authMode }, "products", { query: { per_page: "1", _cb: randomBytes(4).toString("hex") } });
      expectArray(data, "products", new URL(creds.siteUrl).host);
      return authMode;
    } catch (e) {
      lastError = e;
      if (e instanceof HttpError && e.status === 401) {
        const ignored = e.code === "woocommerce_rest_cannot_view";
        const badSignature = e.code === "woocommerce_rest_authentication_error" && /signature|timestamp|nonce/i.test(e.message);
        if (ignored || badSignature) continue;
        // "Consumer key is invalid", "permissions"…: the keys themselves are the problem.
        throw new HttpError(401, `${new URL(creds.siteUrl).host} rejected the API keys: ${e.message.replace(/^.*?answered \d+: /, "")}. Check the consumer key and secret, and that the key has Read/Write permissions.`);
      }
      throw e;
    }
  }
  throw lastError instanceof Error ? lastError : new HttpError(401, "The API keys were not accepted.");
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
    if (e instanceof HttpError && (e.status === 401 || e.status === 409)) throw e;
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

export interface NewWooProduct {
  name: string;
  sku: string;
  price?: number;
  description?: string;
  stockQuantity?: number;
  weight?: number;
  dimensions?: { length?: number; width?: number; height?: number };
  barcode?: string;
  /** Publish at once; otherwise the product waits as a draft. */
  publish?: boolean;
}

/** Creates a simple product, as a draft unless asked to publish it straight away. */
export async function createProduct(creds: WooCreds, p: NewWooProduct): Promise<{ id: string }> {
  const body: Record<string, unknown> = {
    name: p.name,
    sku: p.sku,
    type: "simple",
    status: p.publish ? "publish" : "draft",
    manage_stock: true,
    stock_quantity: Math.max(0, Math.round(p.stockQuantity ?? 0)),
  };
  if (p.price !== undefined && p.price > 0) body.regular_price = String(p.price);
  if (p.description) body.description = p.description;
  if (p.weight) body.weight = String(p.weight);
  if (p.dimensions && (p.dimensions.length || p.dimensions.width || p.dimensions.height)) body.dimensions = { length: String(p.dimensions.length ?? ""), width: String(p.dimensions.width ?? ""), height: String(p.dimensions.height ?? "") };
  if (p.barcode) body.global_unique_id = p.barcode;
  const { data } = await request<{ id?: number }>(creds, "products", { method: "POST", body });
  if (!data || typeof data.id !== "number") throw new HttpError(502, `${new URL(creds.siteUrl).host} did not confirm the new product ${p.sku}.`);
  return { id: String(data.id) };
}

export interface WooRef {
  productId: string;
  variationId?: string;
}

/** Looks up store records for a set of SKUs in one call (variations come back as type "variation" with a parent_id). */
export async function findProductsBySku(creds: WooCreds, skus: string[]): Promise<Map<string, WooRef>> {
  const out = new Map<string, WooRef>();
  for (let i = 0; i < skus.length; i += 50) {
    const chunk = skus.slice(i, i + 50);
    const { data } = await request<unknown>(creds, "products", { query: { sku: chunk.join(","), per_page: "100", status: "any" } });
    for (const p of expectArray<WooProduct & { parent_id?: number }>(data, "products", new URL(creds.siteUrl).host)) {
      if (!p.sku) continue;
      out.set(p.sku.trim().toUpperCase(), p.type === "variation" && p.parent_id ? { productId: String(p.parent_id), variationId: String(p.id) } : { productId: String(p.id) });
    }
  }
  return out;
}

/** Sets stock on many products with the batch endpoints: one call per 100 simple products, one per parent for variations. */
export async function batchUpdateStock(creds: WooCreds, updates: Array<WooRef & { qty: number }>): Promise<void> {
  const simple = updates.filter((u) => !u.variationId);
  for (let i = 0; i < simple.length; i += 100) {
    await request(creds, "products/batch", { method: "POST", body: { update: simple.slice(i, i + 100).map((u) => ({ id: Number(u.productId), manage_stock: true, stock_quantity: Math.max(0, Math.round(u.qty)) })) } });
  }
  const byParent = new Map<string, Array<WooRef & { qty: number }>>();
  for (const u of updates) if (u.variationId) byParent.set(u.productId, [...(byParent.get(u.productId) ?? []), u]);
  for (const [parent, list] of byParent) {
    for (let i = 0; i < list.length; i += 100) {
      await request(creds, `products/${parent}/variations/batch`, { method: "POST", body: { update: list.slice(i, i + 100).map((u) => ({ id: Number(u.variationId), manage_stock: true, stock_quantity: Math.max(0, Math.round(u.qty)) })) } });
    }
  }
}

export interface WooProductPatch {
  name?: string;
  description?: string;
  price?: number;
  weight?: number;
  dimensions?: { length?: number; width?: number; height?: number };
  barcode?: string;
  /** publish / draft */
  status?: "publish" | "draft";
}

/** Updates the fields Cumulus owns on a product or variation. */
export async function updateProduct(creds: WooCreds, ref: WooRef, p: WooProductPatch): Promise<void> {
  const body: Record<string, unknown> = {};
  if (p.name !== undefined && !ref.variationId) body.name = p.name;
  if (p.description !== undefined && !ref.variationId) body.description = p.description;
  if (p.price !== undefined) body.regular_price = p.price > 0 ? String(p.price) : "";
  if (p.weight !== undefined) body.weight = p.weight ? String(p.weight) : "";
  if (p.dimensions) body.dimensions = { length: String(p.dimensions.length ?? ""), width: String(p.dimensions.width ?? ""), height: String(p.dimensions.height ?? "") };
  if (p.barcode !== undefined) body.global_unique_id = p.barcode;
  if (p.status) body.status = p.status;
  if (Object.keys(body).length === 0) return;
  const path = ref.variationId ? `products/${ref.productId}/variations/${ref.variationId}` : `products/${ref.productId}`;
  await request(creds, path, { method: "PUT", body });
}

/** Moves a product to the trash (recoverable in WooCommerce) or deletes it outright. */
export async function deleteProduct(creds: WooCreds, ref: WooRef, opts: { force?: boolean } = {}): Promise<void> {
  const path = ref.variationId ? `products/${ref.productId}/variations/${ref.variationId}` : `products/${ref.productId}`;
  try {
    await request(creds, path, { method: "DELETE", query: { force: opts.force ? "true" : "false" } });
  } catch (e) {
    // Already gone counts as done.
    if (e instanceof HttpError && (e.status === 404 || e.code === "woocommerce_rest_product_invalid_id" || e.code === "woocommerce_rest_invalid_id")) return;
    throw e;
  }
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
