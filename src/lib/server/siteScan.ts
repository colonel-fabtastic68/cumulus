import type { ImportRow } from "@/lib/inventory";
import { HttpError, USER_AGENT } from "@/lib/integrations/server";

/**
 * Reads a business's own website for its catalog: the platform feed when the
 * site is Shopify or WooCommerce, otherwise product pages found through the
 * sitemap and their JSON-LD / OpenGraph product data. Names, SKUs, prices,
 * barcodes, images and categories come through; quantities and costs never
 * do (no site publishes them), which is where a store connection and Strato
 * take over.
 */

export type SitePlatform = "shopify" | "woocommerce" | "generic";

export interface SiteScanResult {
  platform: SitePlatform;
  site: string;
  rows: ImportRow[];
  /** How many rows had no SKU and were given one from the name. */
  namedAsSku: number;
  pagesScanned: number;
  warnings: string[];
  truncated: boolean;
}

export const LIMITS = { products: 2000, pages: 150, concurrency: 5, timeoutMs: 12_000, totalMs: 100_000 };

export function normalizeSiteUrl(input: string): string {
  const raw = input.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!raw || /\s/.test(raw) || !raw.includes(".")) throw new HttpError(400, "Enter your website address, like shop.example.com.");
  const host = raw.split("/")[0]!.toLowerCase();
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || host.endsWith(".local")) throw new HttpError(400, "That address is not a public website.");
  return `https://${raw}`;
}

async function get(url: string, accept = "text/html,application/json"): Promise<{ status: number; text: string; contentType: string }> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: accept }, redirect: "follow", signal: AbortSignal.timeout(LIMITS.timeoutMs) });
  return { status: res.status, text: await res.text(), contentType: res.headers.get("content-type") ?? "" };
}

// ---- robots -----------------------------------------------------------------------

/** Paths disallowed for everyone (User-agent: *). We only ever read a site its owner typed in, but we still honour this. */
export function parseRobots(text: string): string[] {
  const out: string[] = [];
  let applies = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const [, key, value] = m;
    if (key!.toLowerCase() === "user-agent") applies = value!.trim() === "*";
    else if (applies && key!.toLowerCase() === "disallow" && value!.trim()) out.push(value!.trim());
  }
  return out;
}

export function robotsAllows(disallowed: string[], path: string): boolean {
  return !disallowed.some((rule) => rule !== "/" && path.startsWith(rule.replace(/\*$/, "")));
}

// ---- Shopify ----------------------------------------------------------------------

interface ShopifyFeedProduct {
  id: number;
  title: string;
  handle: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  tags?: string[] | string;
  images?: Array<{ src: string }>;
  variants: Array<{ id: number; title: string; sku?: string | null; price: string; available?: boolean; barcode?: string | null; grams?: number }>;
}

export function shopifyFeedRows(products: ShopifyFeedProduct[]): ImportRow[] {
  const rows: ImportRow[] = [];
  for (const p of products) {
    const multi = p.variants.length > 1;
    for (const v of p.variants) {
      rows.push({
        sku: (v.sku ?? "").trim(),
        name: multi && v.title && v.title !== "Default Title" ? `${p.title} – ${v.title}` : p.title,
        description: p.body_html ? stripHtml(p.body_html).slice(0, 1000) || undefined : undefined,
        category: p.product_type || undefined,
        brand: p.vendor || undefined,
        tags: Array.isArray(p.tags) ? p.tags : p.tags ? p.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
        price: Number(v.price) || undefined,
        barcode: v.barcode?.trim() || undefined,
        weight: v.grams ? v.grams / 1000 : undefined,
        imageUrl: p.images?.[0]?.src,
        externalId: String(p.id),
        externalSource: "shopify",
        published: v.available !== false,
      });
    }
  }
  return rows;
}

async function scanShopify(site: string, warnings: string[]): Promise<{ rows: ImportRow[]; pages: number; truncated: boolean }> {
  const rows: ImportRow[] = [];
  let pages = 0;
  for (let page = 1; page <= 20; page++) {
    const { status, text } = await get(`${site}/products.json?limit=250&page=${page}`, "application/json");
    if (status !== 200) {
      if (page === 1) throw new HttpError(502, `The store did not serve its product feed (${status}).`);
      break;
    }
    let data: { products?: ShopifyFeedProduct[] } = {};
    try {
      data = JSON.parse(text);
    } catch {
      warnings.push("The product feed answered with something that was not JSON; stopped there.");
      break;
    }
    pages++;
    const batch = data.products ?? [];
    rows.push(...shopifyFeedRows(batch));
    if (batch.length < 250) break;
    if (rows.length >= LIMITS.products) return { rows: rows.slice(0, LIMITS.products), pages, truncated: true };
  }
  return { rows, pages, truncated: false };
}

// ---- WooCommerce ------------------------------------------------------------------

interface WooStoreProduct {
  id: number;
  name: string;
  sku?: string;
  description?: string;
  short_description?: string;
  categories?: Array<{ name: string }>;
  tags?: Array<{ name: string }>;
  images?: Array<{ src: string }>;
  prices?: { price?: string; currency_minor_unit?: number };
  is_in_stock?: boolean;
  variations?: Array<{ id: number; attributes?: Array<{ value: string }> }>;
}

export function wooStoreRows(products: WooStoreProduct[]): ImportRow[] {
  return products.map((p) => {
    const minor = p.prices?.currency_minor_unit ?? 2;
    const price = p.prices?.price ? Number(p.prices.price) / 10 ** minor : undefined;
    return {
      sku: (p.sku ?? "").trim(),
      name: p.name,
      description: stripHtml(p.short_description || p.description || "").slice(0, 1000) || undefined,
      category: p.categories?.[0]?.name,
      tags: p.tags?.map((t) => t.name),
      price: price && price > 0 ? price : undefined,
      imageUrl: p.images?.[0]?.src,
      externalId: String(p.id),
      externalSource: "woocommerce",
      published: p.is_in_stock !== false,
    };
  });
}

async function scanWoo(site: string, warnings: string[]): Promise<{ rows: ImportRow[]; pages: number; truncated: boolean }> {
  const rows: ImportRow[] = [];
  let pages = 0;
  for (let page = 1; page <= 20; page++) {
    const { status, text } = await get(`${site}/wp-json/wc/store/v1/products?per_page=100&page=${page}`, "application/json");
    if (status !== 200) {
      if (page === 1) throw new HttpError(502, `The store's product API did not answer (${status}).`);
      break;
    }
    let data: WooStoreProduct[] = [];
    try {
      data = JSON.parse(text);
    } catch {
      warnings.push("The product API answered with something that was not JSON; stopped there.");
      break;
    }
    if (!Array.isArray(data)) break;
    pages++;
    rows.push(...wooStoreRows(data));
    if (data.length < 100) break;
    if (rows.length >= LIMITS.products) return { rows: rows.slice(0, LIMITS.products), pages, truncated: true };
  }
  return { rows, pages, truncated: false };
}

// ---- generic: sitemap + JSON-LD / OpenGraph ----------------------------------------

export function sitemapUrls(xml: string): { sitemaps: string[]; pages: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decodeXml(m[1]!));
  const isIndex = /<sitemapindex/i.test(xml);
  return isIndex ? { sitemaps: locs, pages: [] } : { sitemaps: [], pages: locs };
}

/** URLs that look like product pages, most likely first. */
export function productLikeUrls(urls: string[]): string[] {
  const score = (u: string) => {
    const p = u.toLowerCase();
    if (/\/(products?|item|items|p|shop|store|catalog|sku)\/[^/]+\/?$/.test(p)) return 3;
    if (/\/(products?|shop|store|catalog)\//.test(p)) return 2;
    if (/\.(jpg|png|gif|pdf|xml|css|js)$/.test(p) || /\/(blog|news|about|contact|cart|checkout|account|login|tag|category|collections?)(\/|$)/.test(p)) return 0;
    return 1;
  };
  return urls
    .map((u) => ({ u, s: score(u) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.u);
}

interface JsonLdProduct {
  "@type"?: string | string[];
  name?: string;
  sku?: string;
  mpn?: string;
  gtin?: string;
  gtin13?: string;
  gtin12?: string;
  gtin8?: string;
  description?: string;
  image?: string | string[] | { url?: string } | Array<{ url?: string }>;
  brand?: string | { name?: string };
  category?: string;
  offers?: JsonLdOffer | JsonLdOffer[] | { offers?: JsonLdOffer[] };
  "@graph"?: unknown[];
}
interface JsonLdOffer {
  price?: string | number;
  lowPrice?: string | number;
  availability?: string;
  sku?: string;
}

function walkJsonLd(node: unknown, out: JsonLdProduct[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) walkJsonLd(n, out);
    return;
  }
  const obj = node as JsonLdProduct;
  const type = obj["@type"];
  const types = Array.isArray(type) ? type : type ? [type] : [];
  if (types.some((t) => /^(Product|ProductGroup|IndividualProduct)$/i.test(String(t)))) out.push(obj);
  if (obj["@graph"]) walkJsonLd(obj["@graph"], out);
  for (const [k, v] of Object.entries(obj)) if (k !== "@graph" && v && typeof v === "object") walkJsonLd(v, out);
}

/** Product rows from one HTML page: JSON-LD Product first, OpenGraph as the fallback. */
export function rowsFromHtml(html: string, url: string): ImportRow[] {
  const found: JsonLdProduct[] = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walkJsonLd(JSON.parse(m[1]!.trim()), found);
    } catch {
      // Malformed JSON-LD is common; skip the block.
    }
  }
  const rows: ImportRow[] = [];
  for (const p of found) {
    if (!p.name) continue;
    const offers = p.offers && "offers" in p.offers && Array.isArray((p.offers as { offers?: JsonLdOffer[] }).offers) ? (p.offers as { offers: JsonLdOffer[] }).offers : Array.isArray(p.offers) ? p.offers : p.offers ? [p.offers as JsonLdOffer] : [];
    const offer = offers[0];
    const price = offer ? Number(offer.price ?? offer.lowPrice) : NaN;
    const image = Array.isArray(p.image) ? p.image[0] : p.image;
    rows.push({
      sku: String(p.sku ?? offer?.sku ?? p.mpn ?? "").trim(),
      name: String(p.name).trim(),
      description: p.description ? stripHtml(String(p.description)).slice(0, 1000) : undefined,
      category: p.category ? String(p.category) : undefined,
      brand: typeof p.brand === "string" ? p.brand : p.brand?.name,
      price: Number.isFinite(price) && price > 0 ? price : undefined,
      barcode: (p.gtin ?? p.gtin13 ?? p.gtin12 ?? p.gtin8) ? String(p.gtin ?? p.gtin13 ?? p.gtin12 ?? p.gtin8) : undefined,
      imageUrl: typeof image === "string" ? image : (image as { url?: string } | undefined)?.url,
      externalId: url,
      published: offer?.availability ? !/OutOfStock|Discontinued/i.test(offer.availability) : true,
    });
  }
  if (rows.length === 0) {
    const meta = (prop: string) => new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i").exec(html)?.[1] ?? new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i").exec(html)?.[1];
    if (/og:type["'][^>]+content=["'](?:product|og:product)/i.test(html) || meta("product:price:amount")) {
      const price = Number(meta("product:price:amount"));
      rows.push({ sku: meta("product:retailer_item_id") ?? "", name: decodeHtml(meta("og:title") ?? ""), description: meta("og:description") ? decodeHtml(meta("og:description")!) : undefined, price: Number.isFinite(price) && price > 0 ? price : undefined, imageUrl: meta("og:image"), externalId: url, published: true });
    }
  }
  return rows.filter((r) => r.name);
}

async function scanGeneric(site: string, warnings: string[], deadline: number): Promise<{ rows: ImportRow[]; pages: number; truncated: boolean }> {
  const disallowed = await get(`${site}/robots.txt`, "text/plain").then((r) => (r.status === 200 ? parseRobots(r.text) : [])).catch(() => [] as string[]);
  const candidates: string[] = [];
  const seenMaps = new Set<string>();
  const queue = [`${site}/sitemap.xml`, `${site}/sitemap_index.xml`, `${site}/product-sitemap.xml`];
  while (queue.length && candidates.length < 5000 && Date.now() < deadline) {
    const mapUrl = queue.shift()!;
    if (seenMaps.has(mapUrl) || seenMaps.size > 30) continue;
    seenMaps.add(mapUrl);
    const res = await get(mapUrl, "application/xml,text/xml").catch(() => null);
    if (!res || res.status !== 200 || !/<(urlset|sitemapindex)/i.test(res.text)) continue;
    const { sitemaps, pages } = sitemapUrls(res.text);
    queue.push(...sitemaps.filter((s) => /product|shop|catalog|item|page/i.test(s) || sitemaps.length < 20));
    candidates.push(...pages);
  }
  if (candidates.length === 0) {
    // No sitemap: try the home page itself and its product-looking links.
    const home = await get(site).catch(() => null);
    if (!home || home.status !== 200) throw new HttpError(502, "Could not read the site (no sitemap and the home page did not load).");
    const links = [...home.text.matchAll(/href=["']([^"'#?]+)["']/gi)].map((m) => m[1]!).map((h) => (h.startsWith("http") ? h : h.startsWith("/") ? `${site}${h}` : `${site}/${h}`)).filter((h) => h.startsWith(site));
    candidates.push(site, ...links);
  }
  const host = new URL(site).host;
  const urls = productLikeUrls(Array.from(new Set(candidates)))
    .filter((u) => {
      try {
        const x = new URL(u);
        return x.host === host && robotsAllows(disallowed, x.pathname);
      } catch {
        return false;
      }
    })
    .slice(0, LIMITS.pages);
  const rows: ImportRow[] = [];
  let pages = 0;
  let i = 0;
  const worker = async () => {
    while (i < urls.length && Date.now() < deadline) {
      const u = urls[i++]!;
      const res = await get(u).catch(() => null);
      if (!res || res.status !== 200 || !/html/.test(res.contentType)) continue;
      pages++;
      rows.push(...rowsFromHtml(res.text, u));
    }
  };
  await Promise.all(Array.from({ length: LIMITS.concurrency }, worker));
  if (Date.now() >= deadline && i < urls.length) warnings.push(`Stopped after ${pages} pages so the scan finishes in time; run it again to pick up the rest, or upload a CSV.`);
  return { rows, pages, truncated: i < urls.length };
}

// ---- entry -------------------------------------------------------------------------

export async function detectPlatform(site: string): Promise<SitePlatform> {
  const home = await get(site).catch(() => null);
  if (home && home.status === 200) {
    if (/Shopify\.shop\s*=|cdn\.shopify\.com/i.test(home.text)) return "shopify";
    if (/wp-content\/plugins\/woocommerce|woocommerce/i.test(home.text)) return "woocommerce";
  }
  const shop = await get(`${site}/products.json?limit=1`, "application/json").catch(() => null);
  if (shop && shop.status === 200 && /"products"\s*:/.test(shop.text)) return "shopify";
  const woo = await get(`${site}/wp-json/wc/store/v1/products?per_page=1`, "application/json").catch(() => null);
  if (woo && woo.status === 200 && woo.text.trim().startsWith("[")) return "woocommerce";
  return "generic";
}

/** Dedupes by SKU (or name), fills missing SKUs from names, and counts what was made up. */
export function finalizeRows(rows: ImportRow[]): { rows: ImportRow[]; namedAsSku: number } {
  const seen = new Set<string>();
  const out: ImportRow[] = [];
  let namedAsSku = 0;
  for (const r of rows) {
    let sku = r.sku.trim();
    if (!sku) {
      sku = (r.name ?? "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
      if (!sku) continue;
      namedAsSku++;
    }
    const key = sku.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, sku });
  }
  return { rows: out, namedAsSku };
}

export async function scanSite(input: string): Promise<SiteScanResult> {
  const site = normalizeSiteUrl(input);
  const started = Date.now();
  const warnings: string[] = [];
  const platform = await detectPlatform(site);
  const result = platform === "shopify" ? await scanShopify(site, warnings) : platform === "woocommerce" ? await scanWoo(site, warnings) : await scanGeneric(site, warnings, started + LIMITS.totalMs);
  const { rows, namedAsSku } = finalizeRows(result.rows);
  if (rows.length === 0) warnings.push(platform === "generic" ? "No product data was found on the pages scanned. If the shop is built with JavaScript only, upload a CSV instead or connect the store." : "The feed was empty.");
  return { platform, site, rows, namedAsSku, pagesScanned: result.pages, warnings, truncated: result.truncated };
}

function stripHtml(s: string): string {
  return decodeHtml(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function decodeHtml(s: string): string {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");
}
function decodeXml(s: string): string {
  return decodeHtml(s.trim());
}
