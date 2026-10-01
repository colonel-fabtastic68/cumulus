import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { OAuthState } from "@/lib/server/quickbooksRules";
import { OAUTH_STATES } from "./quickbooks";
import { HttpError, USER_AGENT, writeSecrets, type Secrets, type ServerContext } from "./server";
import type { Integration } from "@/lib/types";
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

export interface ShopifyTokens {
  accessToken: string;
  scope: string;
  /** Present for expiring offline tokens (every public app now); absent for a pasted custom-app token. */
  refreshToken?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
}

interface TokenResponse {
  access_token?: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  error?: string;
  error_description?: string;
}

async function tokenRequest(shop: string, body: Record<string, string>, what: string): Promise<ShopifyTokens> {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": USER_AGENT },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: TokenResponse = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok || !data.access_token) throw new HttpError(502, `Shopify did not ${what} (${res.status}${data.error ? ` ${data.error}` : ""}${data.error_description ? `: ${data.error_description}` : ""}).`);
  const now = Date.now();
  return {
    accessToken: data.access_token,
    scope: data.scope ?? "",
    refreshToken: data.refresh_token,
    accessTokenExpiresAt: data.expires_in ? new Date(now + data.expires_in * 1000).toISOString() : undefined,
    refreshTokenExpiresAt: data.refresh_token_expires_in ? new Date(now + data.refresh_token_expires_in * 1000).toISOString() : undefined,
  };
}

/**
 * Exchanges the authorization code for an expiring offline token (an hour,
 * plus a refresh token good for 90 days that rotates on every refresh).
 * Shopify no longer accepts the non-expiring kind from public apps.
 */
export function exchangeShopifyCode(config: ShopifyAppConfig, shop: string, code: string): Promise<ShopifyTokens> {
  return tokenRequest(shop, { client_id: config.clientId, client_secret: config.clientSecret, code, expiring: "1" }, "issue a token");
}

/** Trades the stored refresh token for a new access token and a new refresh token. No merchant interaction. */
export function refreshShopifyToken(config: ShopifyAppConfig, shop: string, refreshToken: string): Promise<ShopifyTokens> {
  return tokenRequest(shop, { client_id: config.clientId, client_secret: config.clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }, "refresh the token");
}

/** Refresh when the access token is within five minutes of expiring. */
const REFRESH_AHEAD_MS = 5 * 60_000;

/**
 * The secrets to use for a Shopify call right now: refreshed and saved when
 * the access token is about to expire. Pasted custom-app tokens have no
 * refresh token and pass through untouched. A refresh token that Shopify
 * rejects (expired after 90 idle days, or the app was uninstalled) surfaces
 * as a clear "connect again" error.
 */
export async function freshShopifySecrets(ctx: Pick<ServerContext, "db" | "workspaceId">, integration: Pick<Integration, "config">, secrets: Secrets): Promise<Secrets> {
  const shop = integration.config?.shop;
  if (!shop || !secrets.refreshToken) return secrets;
  const expiresAt = secrets.accessTokenExpiresAt ? new Date(secrets.accessTokenExpiresAt).getTime() : 0;
  if (expiresAt - Date.now() > REFRESH_AHEAD_MS) return secrets;
  const config = requireShopifyAppConfig();
  let tokens: ShopifyTokens;
  try {
    tokens = await refreshShopifyToken(config, shop, secrets.refreshToken);
  } catch (e) {
    throw new HttpError(401, `Shopify access for ${shop} could not be renewed (${e instanceof Error ? e.message : String(e)}). Open Integrations and connect the store again.`);
  }
  const next: Secrets = { ...secrets, accessToken: tokens.accessToken, ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}), ...(tokens.accessTokenExpiresAt ? { accessTokenExpiresAt: tokens.accessTokenExpiresAt } : {}), ...(tokens.refreshTokenExpiresAt ? { refreshTokenExpiresAt: tokens.refreshTokenExpiresAt } : {}) };
  await writeSecrets(ctx, "shopify", next);
  return next;
}
