import { createHmac, randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { OAuthState } from "@/lib/server/quickbooksRules";
import { OAUTH_STATES, consumeState } from "./quickbooks";
import { HttpError, USER_AGENT, fetchJson, readSecrets, safeEqual, writeSecrets, type Secrets, type ServerContext } from "./server";

/**
 * Square: the Catalog, Inventory and Locations APIs behind either of two
 * credentials. OAuth 2.0 (authorization code grant, this server's own Square
 * application) gives 30-day access tokens refreshed with the non-expiring
 * refresh token a week before the edge or on a 401. A seller can instead paste
 * the access token of an application they create in their own Developer
 * Console: it never expires, needs no server-side app, and is revoked from
 * that console.
 */

export type SquareEnvironment = "sandbox" | "production";

export interface SquareConfig {
  applicationId: string;
  applicationSecret: string;
  environment: SquareEnvironment;
}

export const SQUARE_VERSION = "2026-09-16";
export const SQUARE_SCOPES = ["MERCHANT_PROFILE_READ", "ITEMS_READ", "INVENTORY_READ", "ORDERS_READ", "CUSTOMERS_READ"];
const REFRESH_MARGIN_MS = 7 * 86_400_000;

function envValue(name: string): string {
  return (process.env[name] ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
}

/**
 * Square credentials name their own environment: production application ids
 * start with `sq0idp-`, Sandbox ones with `sandbox-`. The id decides which
 * host the consent page and the API live on; SQUARE_ENVIRONMENT only breaks
 * a tie when the id has an unfamiliar shape. Sending a production app to the
 * Sandbox host strands the seller on Square's dashboard after they log in.
 */
export function squareEnvironmentFor(applicationId: string, explicit = envValue("SQUARE_ENVIRONMENT")): SquareEnvironment {
  if (/^sandbox-/i.test(applicationId)) return "sandbox";
  if (/^sq0idp-/i.test(applicationId)) return "production";
  return /^prod/i.test(explicit) ? "production" : "sandbox";
}

export function squareConfig(): SquareConfig | null {
  const applicationId = envValue("SQUARE_APPLICATION_ID");
  const applicationSecret = envValue("SQUARE_APPLICATION_SECRET");
  if (!applicationId || !applicationSecret) return null;
  return { applicationId, applicationSecret, environment: squareEnvironmentFor(applicationId) };
}

export function requireSquareConfig(): SquareConfig {
  const config = squareConfig();
  if (!config) throw new HttpError(503, "Square sign-in is not configured on this server. Add SQUARE_APPLICATION_ID and SQUARE_APPLICATION_SECRET to the deployment's environment, or paste the access token from your own Square application instead.");
  return config;
}

/** A token the seller pasted from their own Square application, as opposed to one this server's OAuth app was granted. */
export function isPersonalToken(secrets: Secrets): boolean {
  return secrets.tokenKind === "personal" || (!secrets.refreshToken && !!secrets.accessToken);
}

export function squareBase(environment: SquareEnvironment): string {
  return environment === "production" ? "https://connect.squareup.com" : "https://connect.squareupsandbox.com";
}

export function squareRedirectUri(base: string): string {
  return `${base}/api/integrations/square/callback`;
}

/**
 * Stores a single-use state and returns Square's consent URL. A seller who is
 * already signed in goes straight to the permission form; `session=false`
 * would route everyone through app.squareup.com/login first, and Safari's
 * fingerprinting protection stops that page reading the parameters that
 * carry the flow forward, stranding the seller on their dashboard.
 */
export async function beginSquareAuthorization(ctx: Pick<ServerContext, "db" | "workspaceId" | "actor">, base: string, config = requireSquareConfig()): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  const doc: OAuthState = { workspaceId: ctx.workspaceId, uid: ctx.actor.id, provider: "square", createdAt: new Date().toISOString() };
  await ctx.db.doc(`${OAUTH_STATES}/${state}`).set(doc);
  const url = new URL(`${squareBase(config.environment)}/oauth2/authorize`);
  url.searchParams.set("client_id", config.applicationId);
  url.searchParams.set("scope", SQUARE_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", squareRedirectUri(base));
  return url.toString();
}

export function consumeSquareState(db: Firestore, state: string): Promise<OAuthState> {
  return consumeState(db, state, "square");
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  merchant_id: string;
  refresh_token?: string;
}

async function obtainToken(config: SquareConfig, body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${squareBase(config.environment)}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "Square-Version": SQUARE_VERSION, "User-Agent": USER_AGENT },
    body: JSON.stringify({ client_id: config.applicationId, client_secret: config.applicationSecret, ...body }),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: Partial<TokenResponse> & { errors?: Array<{ code?: string; detail?: string }> } = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok || !data.access_token) {
    const err = data.errors?.[0];
    const code = err?.code ?? "";
    const permanent = res.status === 401 || /INVALID|UNAUTHORIZED|REVOKED/i.test(code);
    throw new HttpError(permanent ? 401 : 502, `Square did not issue a token (${res.status}${code ? ` ${code}` : ""}${err?.detail ? `: ${err.detail}` : ""}).`, permanent ? "invalid_grant" : code || undefined);
  }
  return data as TokenResponse;
}

/** Turns the authorization code into the secrets we keep for this workspace. */
export async function exchangeSquareCode(config: SquareConfig, code: string, base: string): Promise<Secrets> {
  const t = await obtainToken(config, { grant_type: "authorization_code", code, redirect_uri: squareRedirectUri(base) });
  if (!t.refresh_token) throw new HttpError(502, "Square did not return a refresh token; the app may be set to the PKCE flow.");
  return { accessToken: t.access_token, refreshToken: t.refresh_token, accessExpiresAt: t.expires_at, merchantId: t.merchant_id, environment: config.environment };
}

async function refreshSquare(ctx: Pick<ServerContext, "db" | "workspaceId">, config: SquareConfig, secrets: Secrets): Promise<Secrets> {
  const t = await obtainToken(config, { grant_type: "refresh_token", refresh_token: secrets.refreshToken });
  const next: Secrets = { ...secrets, accessToken: t.access_token, accessExpiresAt: t.expires_at, merchantId: t.merchant_id || secrets.merchantId, ...(t.refresh_token ? { refreshToken: t.refresh_token } : {}) };
  await writeSecrets(ctx, "square", next);
  return next;
}

export async function revokeSquare(config: SquareConfig, secrets: Secrets): Promise<void> {
  await fetch(`${squareBase(config.environment)}/oauth2/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Client ${config.applicationSecret}`, "Square-Version": SQUARE_VERSION, "User-Agent": USER_AGENT },
    body: JSON.stringify({ client_id: config.applicationId, access_token: secrets.accessToken }),
    signal: AbortSignal.timeout(15_000),
  });
}

/**
 * Runs `fn` with a live token. OAuth tokens are refreshed a week before expiry
 * and once more on a 401; a dead refresh token asks for a reconnect. A pasted
 * token has nothing to refresh, so a 401 means it was revoked or replaced.
 */
export async function withSquareToken<T>(ctx: ServerContext, secrets: Secrets, fn: (accessToken: string, environment: SquareEnvironment) => Promise<T>): Promise<T> {
  if (isPersonalToken(secrets)) {
    const environment = (secrets.environment as SquareEnvironment | undefined) ?? "production";
    try {
      return await fn(secrets.accessToken, environment);
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) throw await needsReconnect(ctx, "Square no longer accepts the access token (revoked or replaced in the Developer Console). Paste the current one to connect again.");
      throw e;
    }
  }
  const config = requireSquareConfig();
  const environment = (secrets.environment as SquareEnvironment | undefined) ?? config.environment;
  let current = secrets;
  if (!current.refreshToken || !current.accessToken) throw await needsReconnect(ctx, "Square credentials are incomplete; connect it again.");
  const expires = Date.parse(current.accessExpiresAt ?? "");
  try {
    if (!Number.isFinite(expires) || expires - Date.now() < REFRESH_MARGIN_MS) current = await refreshSquare(ctx, config, current);
    try {
      return await fn(current.accessToken, environment);
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 401)) throw e;
      current = await refreshSquare(ctx, config, current);
      return await fn(current.accessToken, environment);
    }
  } catch (e) {
    if (e instanceof HttpError && (e.code === "invalid_grant" || e.status === 401)) throw await needsReconnect(ctx, e.message);
    throw e;
  }
}

async function needsReconnect(ctx: ServerContext, message: string): Promise<HttpError> {
  try {
    await ctx.store.patch("integrations", "square", { status: "error", lastError: message });
  } catch {
    // The caller still gets the error even if the status could not be recorded.
  }
  return new HttpError(401, message, "invalid_grant");
}

// ---- API ------------------------------------------------------------------------

async function api<T>(environment: SquareEnvironment, accessToken: string, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const { data } = await fetchJson<T>(`${squareBase(environment)}/v2/${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "Square-Version": SQUARE_VERSION, "Content-Type": "application/json", Accept: "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return data;
}

export interface SquareMerchant {
  id: string;
  business_name?: string;
  country?: string;
  currency?: string;
  main_location_id?: string;
}
export interface SquareLocation {
  id: string;
  name?: string;
  status?: string;
}
export interface SquareVariation {
  id: string;
  updated_at?: string;
  item_variation_data?: { item_id?: string; name?: string; sku?: string; upc?: string; price_money?: { amount?: number; currency?: string }; track_inventory?: boolean };
}
export interface SquareItem {
  id: string;
  updated_at?: string;
  is_deleted?: boolean;
  item_data?: { name?: string; description?: string; category_id?: string; variations?: SquareVariation[] };
}
export interface SquareCategory {
  id: string;
  category_data?: { name?: string };
}

export async function merchant(environment: SquareEnvironment, token: string): Promise<SquareMerchant> {
  const data = await api<{ merchant: SquareMerchant[] | SquareMerchant }>(environment, token, "GET", "merchants/me");
  const m = Array.isArray(data.merchant) ? data.merchant[0] : data.merchant;
  if (!m?.id) throw new HttpError(502, "Square did not return the merchant.");
  return m;
}

export async function locations(environment: SquareEnvironment, token: string): Promise<SquareLocation[]> {
  const data = await api<{ locations?: SquareLocation[] }>(environment, token, "GET", "locations");
  return data.locations ?? [];
}

/** Every item and category in the catalog (variations come nested in their items). */
export async function listCatalog(environment: SquareEnvironment, token: string): Promise<{ items: SquareItem[]; categories: SquareCategory[] }> {
  const items: SquareItem[] = [];
  const categories: SquareCategory[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const q = new URLSearchParams({ types: "ITEM,CATEGORY" });
    if (cursor) q.set("cursor", cursor);
    const data = await api<{ objects?: Array<{ type: string } & SquareItem & SquareCategory>; cursor?: string }>(environment, token, "GET", `catalog/list?${q.toString()}`);
    for (const o of data.objects ?? []) {
      if (o.type === "ITEM") items.push(o);
      else if (o.type === "CATEGORY") categories.push(o);
    }
    cursor = data.cursor;
    if (!cursor) break;
  }
  return { items, categories };
}

/** In-stock counts per variation, summed across the given locations. */
export async function inventoryCounts(environment: SquareEnvironment, token: string, variationIds: string[], locationIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < variationIds.length; i += 100) {
    let cursor: string | undefined;
    do {
      const data = await api<{ counts?: Array<{ catalog_object_id: string; state?: string; quantity?: string }>; cursor?: string }>(environment, token, "POST", "inventory/counts/batch-retrieve", { catalog_object_ids: variationIds.slice(i, i + 100), location_ids: locationIds.length ? locationIds : undefined, states: ["IN_STOCK"], cursor });
      for (const c of data.counts ?? []) out.set(c.catalog_object_id, (out.get(c.catalog_object_id) ?? 0) + Number(c.quantity ?? 0));
      cursor = data.cursor;
    } while (cursor);
  }
  return out;
}

/** Reads the stored secrets and confirms the connection still works, returning the merchant and locations for the card. */
export async function verifySquareConnection(ctx: ServerContext): Promise<{ merchant: SquareMerchant; locations: SquareLocation[]; secrets: Secrets }> {
  const secrets = await readSecrets(ctx, "square");
  if (!secrets?.accessToken) throw new HttpError(409, "Square is not connected yet. Use Connect to Square, or paste an access token from your own Square application.");
  const result = await withSquareToken(ctx, secrets, async (token, environment) => ({ merchant: await merchant(environment, token), locations: await locations(environment, token) }));
  return { ...result, secrets };
}

/** Checks a token the seller pasted from their own application against the environment it was copied from. */
export async function verifySquareAccessToken(environment: SquareEnvironment, accessToken: string): Promise<{ merchant: SquareMerchant; locations: SquareLocation[] }> {
  try {
    const [m, locs] = await Promise.all([merchant(environment, accessToken), locations(environment, accessToken)]);
    return { merchant: m, locations: locs };
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) throw new HttpError(400, `Square rejected that access token for the ${environment} environment. Copy it from the application's Credentials page with the toggle at the top set to ${environment === "sandbox" ? "Sandbox" : "Production"}, and paste the whole token.`);
    throw e;
  }
}

// ---- writes and webhooks (ranch bridge) -------------------------------------------

/** A catalog object as the ranch bridge reads it: items with nested variations, and measurement units. */
export interface SquareCatalogObject {
  type: string;
  id: string;
  created_at?: string;
  updated_at?: string;
  is_deleted?: boolean;
  item_data?: {
    name?: string;
    variations?: Array<{
      id: string;
      created_at?: string;
      updated_at?: string;
      is_deleted?: boolean;
      item_variation_data?: { item_id?: string; name?: string; sku?: string; price_money?: { amount?: number }; track_inventory?: boolean; measurement_unit_id?: string };
    }>;
  };
  measurement_unit_data?: { measurement_unit?: { weight_unit?: string; custom_unit?: { name?: string } } };
}

/** Every catalog object of the given types (variations come nested in their items). */
export async function listCatalogObjects(environment: SquareEnvironment, token: string, types: string[]): Promise<SquareCatalogObject[]> {
  const out: SquareCatalogObject[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const q = new URLSearchParams({ types: types.join(",") });
    if (cursor) q.set("cursor", cursor);
    const data = await api<{ objects?: SquareCatalogObject[]; cursor?: string }>(environment, token, "GET", `catalog/list?${q.toString()}`);
    out.push(...(data.objects ?? []));
    cursor = data.cursor;
    if (!cursor) break;
  }
  return out;
}

export interface SquareAdjustment {
  variationId: string;
  locationId: string;
  /** Positive amount, in the variation's unit (pounds keep up to five decimals). */
  quantity: number;
  fromState: "IN_STOCK" | "NONE";
  toState: "SOLD" | "IN_STOCK";
  occurredAt: string;
  referenceId?: string;
}

/** Square keeps five decimal places on inventory quantities. */
export function squareQuantity(n: number): string {
  return (Math.round(n * 100000) / 100000).toFixed(5).replace(/\.?0+$/, "");
}

/**
 * Records adjustments (IN_STOCK → SOLD for a sale, NONE → IN_STOCK to put
 * stock back) in one call per 100. The idempotency key makes a retry with the
 * same key and body a no-op on Square's side.
 */
export async function batchChangeInventory(environment: SquareEnvironment, token: string, adjustments: SquareAdjustment[], idempotencyKey: string): Promise<void> {
  for (let i = 0; i < adjustments.length; i += 100) {
    const chunk = adjustments.slice(i, i + 100);
    await api(environment, token, "POST", "inventory/changes/batch-create", {
      idempotency_key: `${idempotencyKey}-${i / 100}`.slice(0, 128),
      ignore_unchanged_counts: false,
      changes: chunk.map((a) => ({
        type: "ADJUSTMENT",
        adjustment: {
          catalog_object_id: a.variationId,
          catalog_object_type: "ITEM_VARIATION",
          location_id: a.locationId,
          quantity: squareQuantity(a.quantity),
          from_state: a.fromState,
          to_state: a.toState,
          occurred_at: a.occurredAt,
          ...(a.referenceId ? { reference_id: a.referenceId.slice(0, 255) } : {}),
        },
      })),
    });
  }
}

/**
 * Subscribes the seller's own application to events. Only works with the
 * application's personal access token (Square owns subscriptions per app, not
 * per seller), which is how a ranch instance connects.
 */
export async function createWebhookSubscription(environment: SquareEnvironment, token: string, input: { name: string; eventTypes: string[]; notificationUrl: string }): Promise<{ id: string; signatureKey: string }> {
  const data = await api<{ subscription?: { id?: string; signature_key?: string } }>(environment, token, "POST", "webhooks/subscriptions", {
    idempotency_key: randomBytes(16).toString("hex"),
    subscription: { name: input.name, event_types: input.eventTypes, notification_url: input.notificationUrl, api_version: SQUARE_VERSION },
  });
  if (!data.subscription?.id || !data.subscription.signature_key) throw new HttpError(502, "Square did not confirm the webhook subscription.");
  return { id: data.subscription.id, signatureKey: data.subscription.signature_key };
}

export async function deleteWebhookSubscription(environment: SquareEnvironment, token: string, id: string): Promise<void> {
  try {
    await fetchJson(`${squareBase(environment)}/v2/webhooks/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}`, "Square-Version": SQUARE_VERSION } });
  } catch (e) {
    if (e instanceof HttpError && e.status === 502 && /404/.test(e.message)) return;
    throw e;
  }
}

/** Square signs notifications with HMAC-SHA256 over the subscription's URL followed by the raw body (base64). */
export function verifySquareWebhook(rawBody: string, signature: string | null, signatureKey: string, notificationUrl: string): boolean {
  if (!signature || !signatureKey) return false;
  const digest = createHmac("sha256", signatureKey).update(notificationUrl + rawBody, "utf8").digest("base64");
  return safeEqual(digest, signature);
}
