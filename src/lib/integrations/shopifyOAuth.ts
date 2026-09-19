import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { OAuthState } from "@/lib/server/quickbooksRules";
import { OAUTH_STATES } from "./quickbooks";
import { HttpError, USER_AGENT, type ServerContext } from "./server";
import { normalizeShop } from "./shopify";

/**
 * Shopify authorization code grant, for an app that runs outside the Shopify
 * admin: the merchant approves the scopes on their store, Shopify sends the
 * browser back with a code, and the code becomes an offline access token
 * that lasts until the app is uninstalled.
 */

export interface ShopifyAppConfig {
  clientId: string;
  clientSecret: string;
  scopes: string;
}

export const DEFAULT_SHOPIFY_SCOPES = "read_products,write_products,read_inventory,write_inventory,read_orders,read_locations,read_customers";

function envValue(name: string): string {
  return (process.env[name] ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
}

export function shopifyAppConfig(): ShopifyAppConfig | null {
  const clientId = envValue("SHOPIFY_API_KEY");
  const clientSecret = envValue("SHOPIFY_API_SECRET");
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, scopes: envValue("SHOPIFY_SCOPES") || DEFAULT_SHOPIFY_SCOPES };
}

export function requireShopifyAppConfig(): ShopifyAppConfig {
  const config = shopifyAppConfig();
  if (!config) throw new HttpError(503, "Shopify sign-in is not configured on this server. Add SHOPIFY_API_KEY and SHOPIFY_API_SECRET to the deployment's environment, or paste an access token instead.");
  if (!/^[a-f0-9]{20,}$/i.test(config.clientId)) throw new HttpError(503, "SHOPIFY_API_KEY does not look like a Shopify client id. Copy it again from the app's settings.");
  return config;
}

export function shopifyRedirectUri(base: string): string {
  return `${base}/api/integrations/shopify/callback`;
}

/** A custom storefront domain (nothingshirts.com) resolves to its .myshopify.com handle, which Shopify declares in the page. */
export async function resolveShopHandle(input: string): Promise<string> {
  const raw = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!raw) throw new HttpError(400, "Enter the store's address.");
  if (raw.endsWith(".myshopify.com") || !raw.includes(".")) return normalizeShop(raw);
  try {
    const res = await fetch(`https://${raw}/`, { headers: { "User-Agent": USER_AGENT, Accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(10_000) });
    const html = await res.text();
    const m = /Shopify\.shop\s*=\s*"([a-z0-9-]+\.myshopify\.com)"/i.exec(html) ?? /([a-z0-9-]+\.myshopify\.com)/i.exec(html);
    if (m) return normalizeShop(m[1]!);
  } catch {
    // Fall through to the clear error below.
  }
  throw new HttpError(400, `${raw} does not look like a Shopify store. Enter the .myshopify.com address (the part after /store/ in your admin URL).`);
}

/** Stores a single-use state for this workspace and returns the store's consent URL. */
export async function beginShopifyAuthorization(ctx: Pick<ServerContext, "db" | "workspaceId" | "actor">, shopInput: string, base: string, config = requireShopifyAppConfig()): Promise<{ url: string; shop: string }> {
  const shop = await resolveShopHandle(shopInput);
  const state = randomBytes(24).toString("base64url");
  const doc: OAuthState & { shop: string } = { workspaceId: ctx.workspaceId, uid: ctx.actor.id, provider: "shopify", createdAt: new Date().toISOString(), shop };
  await ctx.db.doc(`${OAUTH_STATES}/${state}`).set(doc);
  const url = new URL(`https://${shop}/admin/oauth/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", config.scopes);
  url.searchParams.set("redirect_uri", shopifyRedirectUri(base));
  url.searchParams.set("state", state);
  return { url: url.toString(), shop };
}

/** Shopify signs the callback query with the client secret: HMAC-SHA256 over the other params, sorted, joined with &. */
export function verifyShopifyCallbackHmac(params: URLSearchParams, clientSecret: string): boolean {
  const hmac = params.get("hmac") ?? "";
  if (!/^[a-f0-9]{64}$/i.test(hmac)) return false;
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k.replace(/&/g, "%26").replace(/%/g, "%25").replace(/=/g, "%3D")}=${v.replace(/&/g, "%26").replace(/%/g, "%25")}`)
    .join("&");
  const digest = createHmac("sha256", clientSecret).update(message).digest("hex");
  const a = Buffer.from(digest, "hex");
  const b = Buffer.from(hmac, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Redeems the state Shopify sent back and returns the shop it was issued for. */
export async function consumeShopifyState(db: Firestore, state: string): Promise<OAuthState & { shop: string }> {
  const { consumeState } = await import("./quickbooks");
  const found = (await consumeState(db, state, "shopify")) as OAuthState & { shop?: string };
  if (!found.shop) throw new HttpError(400, "The sign-in state carried no store.");
  return found as OAuthState & { shop: string };
}

/** Exchanges the authorization code for an offline access token. */
export async function exchangeShopifyCode(config: ShopifyAppConfig, shop: string, code: string): Promise<{ accessToken: string; scope: string }> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: { access_token?: string; scope?: string; error?: string; error_description?: string } = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok || !data.access_token) throw new HttpError(502, `Shopify did not issue a token (${res.status}${data.error ? ` ${data.error}` : ""}${data.error_description ? `: ${data.error_description}` : ""}).`);
  return { accessToken: data.access_token, scope: data.scope ?? "" };
}
