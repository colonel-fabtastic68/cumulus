import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { OAuthState } from "@/lib/server/quickbooksRules";
import { OAUTH_STATES, consumeState } from "./quickbooks";
import { HttpError, USER_AGENT, fetchJson, readSecrets, writeSecrets, type Secrets, type ServerContext } from "./server";

/**
 * Clover: the Merchants and Inventory APIs behind either of two credentials.
 * OAuth 2.0 (Clover's v2 authorization code grant, this server's own Clover
 * app) gives expiring access tokens renewed with a refresh token that Clover
 * accepts once and replaces each time. A merchant can instead paste an API
 * token created in their own Clover dashboard (Settings → API tokens): it has
 * nothing to refresh, needs no server-side app, and is deleted from that page.
 */

export type CloverEnvironment = "sandbox" | "production";
/** Clover runs a separate platform per region; an app and its merchants live on one of them. */
export type CloverRegion = "na" | "eu" | "la";

export interface CloverConfig {
  appId: string;
  appSecret: string;
  environment: CloverEnvironment;
  region: CloverRegion;
}

/** Where a merchant account lives: which platform's hosts to talk to, and the merchant on it. */
export interface CloverSite {
  environment: CloverEnvironment;
  region: CloverRegion;
  merchantId: string;
}

export const REGION_NAMES: Record<CloverRegion, string> = { na: "North America", eu: "Europe", la: "Latin America" };

const PRODUCTION_HOSTS: Record<CloverRegion, { www: string; api: string }> = {
  na: { www: "https://www.clover.com", api: "https://api.clover.com" },
  eu: { www: "https://www.eu.clover.com", api: "https://api.eu.clover.com" },
  la: { www: "https://www.la.clover.com", api: "https://api.la.clover.com" },
};
const SANDBOX_HOSTS = { www: "https://sandbox.dev.clover.com", api: "https://apisandbox.dev.clover.com" };

/** Refresh the access token when it is within five minutes of expiring. */
const REFRESH_MARGIN_MS = 5 * 60_000;

function envValue(name: string): string {
  return (process.env[name] ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
}

export function parseRegion(value: string | undefined): CloverRegion {
  const v = (value ?? "").trim().toLowerCase();
  if (v.startsWith("eu")) return "eu";
  if (v.startsWith("la")) return "la";
  return "na";
}

/** The environment choice on the paste form: a production region, or the sandbox. */
export function parsePlace(value: string | undefined): Pick<CloverSite, "environment" | "region"> {
  const v = (value ?? "").trim().toLowerCase();
  if (v.startsWith("sand")) return { environment: "sandbox", region: "na" };
  return { environment: "production", region: parseRegion(v) };
}

export function placeName(site: Pick<CloverSite, "environment" | "region">): string {
  return site.environment === "sandbox" ? "the Sandbox" : REGION_NAMES[site.region];
}

export function cloverHosts(site: Pick<CloverSite, "environment" | "region">): { www: string; api: string } {
  return site.environment === "sandbox" ? SANDBOX_HOSTS : PRODUCTION_HOSTS[site.region];
}

export function cloverConfig(): CloverConfig | null {
  const appId = envValue("CLOVER_APP_ID");
  const appSecret = envValue("CLOVER_APP_SECRET");
  if (!appId || !appSecret) return null;
  return { appId, appSecret, environment: /^prod/i.test(envValue("CLOVER_ENVIRONMENT")) ? "production" : "sandbox", region: parseRegion(envValue("CLOVER_REGION")) };
}

export function requireCloverConfig(): CloverConfig {
  const config = cloverConfig();
  if (!config) throw new HttpError(503, "Clover sign-in is not configured on this server. Add CLOVER_APP_ID and CLOVER_APP_SECRET to the deployment's environment, or paste an API token from your Clover dashboard instead.");
  return config;
}

/** Clover merchant ids are short alphanumeric codes (XKDC2E3WD0VS1). */
export function isMerchantId(value: string): boolean {
  return /^[A-Za-z0-9]{6,32}$/.test(value);
}

/** A token the merchant pasted from their own dashboard, as opposed to one this server's OAuth app was granted. */
export function isPersonalToken(secrets: Secrets): boolean {
  return secrets.tokenKind === "personal" || (!secrets.refreshToken && !!secrets.accessToken);
}

/** The platform and merchant the stored secrets belong to; the server's own setting fills in what older secrets lack. */
export function siteOf(secrets: Secrets, fallback?: Pick<CloverConfig, "environment" | "region">): CloverSite {
  const environment = secrets.environment === "sandbox" || secrets.environment === "production" ? secrets.environment : (fallback?.environment ?? "production");
  const region = secrets.region ? parseRegion(secrets.region) : (fallback?.region ?? "na");
  return { environment, region, merchantId: secrets.merchantId ?? "" };
}

export function cloverRedirectUri(base: string): string {
  return `${base}/api/integrations/clover/callback`;
}

/** Stores a single-use state and returns Clover's consent URL on the platform the app was created in. */
export async function beginCloverAuthorization(ctx: Pick<ServerContext, "db" | "workspaceId" | "actor">, base: string, config = requireCloverConfig()): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  const doc: OAuthState = { workspaceId: ctx.workspaceId, uid: ctx.actor.id, provider: "clover", createdAt: new Date().toISOString() };
  await ctx.db.doc(`${OAUTH_STATES}/${state}`).set(doc);
  const url = new URL(`${cloverHosts(config).www}/oauth/v2/authorize`);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", cloverRedirectUri(base));
  url.searchParams.set("state", state);
  return url.toString();
}

export function consumeCloverState(db: Firestore, state: string): Promise<OAuthState> {
  return consumeState(db, state, "clover");
}

interface TokenResponse {
  access_token: string;
  /** Unix seconds. */
  access_token_expiration?: number;
  refresh_token?: string;
  refresh_token_expiration?: number;
}

/** Clover's expirations are Unix seconds; milliseconds are accepted too rather than filing a date in the year 50,000. */
function epochToIso(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return new Date(value > 1e12 ? value : value * 1000).toISOString();
}

function tokenSecrets(t: TokenResponse): Secrets {
  const accessExpiresAt = epochToIso(t.access_token_expiration);
  const refreshExpiresAt = epochToIso(t.refresh_token_expiration);
  return { accessToken: t.access_token, ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}), ...(accessExpiresAt ? { accessExpiresAt } : {}), ...(refreshExpiresAt ? { refreshExpiresAt } : {}) };
}

async function tokenRequest(config: CloverConfig, path: "token" | "refresh", body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${cloverHosts(config).api}/oauth/v2/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ client_id: config.appId, ...body }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: Partial<TokenResponse> & { message?: string; error?: string; error_description?: string } = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok || !data.access_token) {
    const detail = data.error_description ?? data.message ?? data.error ?? "";
    // 400 and 401 mean the code or refresh token is wrong, already used or expired: only a fresh sign-in fixes that. Anything else may pass.
    const permanent = res.status === 400 || res.status === 401 || res.status === 403;
    throw new HttpError(permanent ? 401 : 502, `Clover did not ${path === "token" ? "issue" : "renew"} a token (${res.status}${detail ? `: ${detail}` : ""}).`, permanent ? "invalid_grant" : undefined);
  }
  return data as TokenResponse;
}

/** Turns the authorization code into the secrets we keep for this workspace; the merchant id came back on the redirect. */
export async function exchangeCloverCode(config: CloverConfig, code: string, merchantId: string): Promise<Secrets> {
  const t = await tokenRequest(config, "token", { client_secret: config.appSecret, code });
  if (!t.refresh_token) throw new HttpError(502, "Clover did not return a refresh token. On the app's settings, Default OAuth Response must be Code and the app must use the v2/OAuth flow.");
  return { ...tokenSecrets(t), merchantId, environment: config.environment, region: config.region };
}

function expiresWithin(iso: string | undefined, ms: number): boolean {
  const at = Date.parse(iso ?? "");
  return !Number.isFinite(at) || at - Date.now() < ms;
}

/**
 * Trades the refresh token for a new pair and stores it. Clover accepts each
 * refresh token once, so a pass that overlaps another (the nightly cron beside
 * a manual sync) first checks whether the stored secrets already moved on and
 * continues from those instead of spending a token that is no longer valid.
 */
async function refreshClover(ctx: Pick<ServerContext, "db" | "workspaceId">, config: CloverConfig, secrets: Secrets): Promise<Secrets> {
  let current = secrets;
  const stored = await readSecrets(ctx, "clover");
  if (stored?.refreshToken && stored.accessToken && !isPersonalToken(stored) && stored.refreshToken !== current.refreshToken) {
    current = stored;
    if (!expiresWithin(current.accessExpiresAt, REFRESH_MARGIN_MS)) return current;
  }
  if (current.refreshExpiresAt && expiresWithin(current.refreshExpiresAt, 0)) throw new HttpError(401, "Clover's refresh token has expired; connect it again.", "invalid_grant");
  const t = await tokenRequest(config, "refresh", { refresh_token: current.refreshToken });
  const next: Secrets = { ...current, ...tokenSecrets(t) };
  await writeSecrets(ctx, "clover", next);
  return next;
}

/**
 * Runs `fn` with a live token. OAuth tokens are refreshed shortly before expiry
 * and once more on a 401; a dead refresh token asks for a reconnect. A pasted
 * token has nothing to refresh, so a 401 means it was deleted or changed.
 */
export async function withCloverToken<T>(ctx: ServerContext, secrets: Secrets, fn: (accessToken: string, site: CloverSite) => Promise<T>): Promise<T> {
  if (!secrets.merchantId) throw await needsReconnect(ctx, "Clover credentials are missing the merchant id; connect it again.");
  if (isPersonalToken(secrets)) {
    try {
      return await fn(secrets.accessToken, siteOf(secrets));
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) throw await needsReconnect(ctx, "Clover no longer accepts the API token (deleted, or its permissions changed, under Settings → API tokens). Paste the current one to connect again.");
      throw e;
    }
  }
  // The app's credentials come from the server; the platform the grant lives on comes from the secrets, in case the server's own setting moved since.
  const base = requireCloverConfig();
  const site = siteOf(secrets, base);
  const config: CloverConfig = { ...base, environment: site.environment, region: site.region };
  let current = secrets;
  if (!current.refreshToken || !current.accessToken) throw await needsReconnect(ctx, "Clover credentials are incomplete; connect it again.");
  try {
    if (expiresWithin(current.accessExpiresAt, REFRESH_MARGIN_MS)) current = await refreshClover(ctx, config, current);
    try {
      return await fn(current.accessToken, site);
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 401)) throw e;
      current = await refreshClover(ctx, config, current);
      return await fn(current.accessToken, site);
    }
  } catch (e) {
    if (e instanceof HttpError && (e.code === "invalid_grant" || e.status === 401)) throw await needsReconnect(ctx, e.message);
    throw e;
  }
}

async function needsReconnect(ctx: ServerContext, message: string): Promise<HttpError> {
  try {
    await ctx.store.patch("integrations", "clover", { status: "error", lastError: message });
  } catch {
    // The caller still gets the error even if the status could not be recorded.
  }
  return new HttpError(401, message, "invalid_grant");
}

// ---- API ------------------------------------------------------------------------

/** GET under /v3/merchants/{mId}; `path` is what follows the merchant id ("?expand=address", "/items?…"). */
async function api<T>(site: CloverSite, accessToken: string, path: string): Promise<T> {
  const { data } = await fetchJson<T>(`${cloverHosts(site).api}/v3/merchants/${encodeURIComponent(site.merchantId)}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  return data;
}

export interface CloverMerchant {
  id: string;
  name?: string;
  address?: { address1?: string; city?: string; state?: string; country?: string };
}
export interface CloverProperties {
  defaultCurrency?: string;
  locale?: string;
  timezone?: string;
}
export interface CloverItem {
  id: string;
  name?: string;
  alternateName?: string;
  sku?: string;
  /** The product code, usually the UPC. */
  code?: string;
  /** Cents; meaningless when priceType is VARIABLE. */
  price?: number;
  priceType?: "FIXED" | "VARIABLE" | "PER_UNIT";
  /** Cents. */
  cost?: number;
  unitName?: string;
  /** Kept off the register. */
  hidden?: boolean;
  /** False while sold out. */
  available?: boolean;
  deleted?: boolean;
  /** Milliseconds since the epoch. */
  modifiedTime?: number;
  categories?: { elements?: Array<{ id: string; name?: string }> };
  itemStock?: { quantity?: number; stockCount?: number };
}

export async function merchant(site: CloverSite, token: string): Promise<CloverMerchant> {
  const m = await api<CloverMerchant>(site, token, "?expand=address");
  if (!m?.id) throw new HttpError(502, "Clover did not return the merchant.");
  return m;
}

export function properties(site: CloverSite, token: string): Promise<CloverProperties> {
  return api<CloverProperties>(site, token, "/properties");
}

/** The merchant and its currency, for the connection card. The currency is a nicety: a token without that permission still connects. */
export async function merchantSummary(site: CloverSite, token: string): Promise<{ merchant: CloverMerchant; currency?: string }> {
  const m = await merchant(site, token);
  const currency = await properties(site, token)
    .then((p) => p.defaultCurrency?.trim().toUpperCase() || undefined)
    .catch(() => undefined);
  return { merchant: m, currency };
}

const PAGE = 1000;

/** Every inventory item with its categories and stock expanded; Clover pages by offset, a thousand at a time. */
export async function listItems(site: CloverSite, token: string): Promise<CloverItem[]> {
  const items: CloverItem[] = [];
  for (let page = 0; page < 100; page++) {
    const q = new URLSearchParams({ expand: "categories,itemStock", limit: String(PAGE), offset: String(page * PAGE) });
    const data = await api<{ elements?: CloverItem[] }>(site, token, `/items?${q.toString()}`);
    const batch = data.elements ?? [];
    items.push(...batch);
    if (batch.length < PAGE) break;
  }
  return items;
}

/** The non-secret connection details shown on the card, from a verified merchant. */
export function connectionConfig(site: CloverSite, merchant: CloverMerchant, currency: string | undefined, auth: "oauth" | "token"): Record<string, string> {
  return {
    merchantId: site.merchantId,
    businessName: merchant.name?.trim() || site.merchantId,
    environment: site.environment,
    region: site.region,
    ...(site.environment === "production" ? { regionName: REGION_NAMES[site.region] } : {}),
    // What the paste form's environment choice should show next time.
    place: site.environment === "sandbox" ? "sandbox" : site.region,
    auth,
    ...(currency ? { currency } : {}),
    ...(merchant.address?.country ? { country: merchant.address.country } : {}),
  };
}

/** Reads the stored secrets and confirms the connection still works, returning the merchant for the card. */
export async function verifyCloverConnection(ctx: ServerContext): Promise<{ merchant: CloverMerchant; currency?: string; secrets: Secrets }> {
  const secrets = await readSecrets(ctx, "clover");
  if (!secrets?.accessToken) throw new HttpError(409, "Clover is not connected yet. Use Connect to Clover, or paste an API token from your Clover dashboard.");
  const result = await withCloverToken(ctx, secrets, (token, site) => merchantSummary(site, token));
  return { ...result, secrets };
}

/** Checks a token the merchant pasted from their dashboard against the merchant and platform they named. */
export async function verifyCloverApiToken(site: CloverSite, accessToken: string): Promise<{ merchant: CloverMerchant; currency?: string }> {
  try {
    return await merchantSummary(site, accessToken);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) throw new HttpError(400, `Clover rejected that API token for merchant ${site.merchantId} in ${placeName(site)}. Check the merchant id, give the token Read permission on Merchant and Inventory under Settings → API tokens, and pick the environment the account lives in.`);
    if (e instanceof HttpError && /answered 404\b/.test(e.message)) throw new HttpError(400, `Clover has no merchant ${site.merchantId} in ${placeName(site)}. The merchant id is under Account & Setup → Business Information in the Clover dashboard; pick the environment the account lives in.`);
    throw e;
  }
}
