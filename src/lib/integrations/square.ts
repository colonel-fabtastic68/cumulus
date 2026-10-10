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
/** A ranch instance also writes: counts and web sales per lot, and new animals as Lot # variations. */
export const SQUARE_RANCH_SCOPES = [...SQUARE_SCOPES, "INVENTORY_WRITE", "ITEMS_WRITE"];
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
export async function beginSquareAuthorization(ctx: Pick<ServerContext, "db" | "workspaceId" | "actor">, base: string, config = requireSquareConfig(), opts: { instanceId?: string; scopes?: string[] } = {}): Promise<string> {
  // An instance's state carries its id so the shared callback knows whose database holds it.
  const state = opts.instanceId ? `${opts.instanceId}__${randomBytes(18).toString("hex")}` : randomBytes(24).toString("base64url");
  const doc: OAuthState = { workspaceId: ctx.workspaceId, uid: ctx.actor.id, provider: "square", createdAt: new Date().toISOString() };
  await ctx.db.doc(`${OAUTH_STATES}/${state}`).set(doc);
  const url = new URL(`${squareBase(config.environment)}/oauth2/authorize`);
  url.searchParams.set("client_id", config.applicationId);
  url.searchParams.set("scope", (opts.scopes ?? SQUARE_SCOPES).join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", squareRedirectUri(base));
  return url.toString();
}

/** The instance a Square sign-in started on, read from its state ("willoranch__…"); null for the shared product. */
export function squareStateInstance(state: string): string | null {
  return /^([a-z0-9-]+)__[0-9a-f]{32,}$/.exec(state)?.[1] ?? null;
}

/**
 * Sellers who sign in with Square are covered by cumulusOS's app-level webhook
 * subscription (set up once in the Square Developer Console, pointing at
 * /api/integrations/square/events); its signature key is in the environment.
 */
export function appWebhookKey(): string {
  return envValue("SQUARE_WEBHOOK_SIGNATURE_KEY");
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

/** Where a catalog object is sold (copied onto new variations so they match their item). */
export interface SquarePresence {
  present_at_all_locations?: boolean;
  present_at_location_ids?: string[];
  absent_at_location_ids?: string[];
}

/** An item variation as the ranch bridge reads and writes it. */
export interface SquareVariationObject extends SquarePresence {
  id: string;
  version?: number;
  created_at?: string;
  updated_at?: string;
  is_deleted?: boolean;
  item_variation_data?: {
    item_id?: string;
    name?: string;
    sku?: string;
    pricing_type?: string;
    price_money?: { amount?: number; currency?: string };
    track_inventory?: boolean;
    measurement_unit_id?: string;
    item_option_values?: Array<{ item_option_id?: string; item_option_value_id?: string }>;
    sellable?: boolean;
    stockable?: boolean;
  };
}

/** A catalog object as the ranch bridge reads it: items with nested variations, measurement units and item options. */
export interface SquareCatalogObject extends SquarePresence {
  type: string;
  id: string;
  version?: number;
  created_at?: string;
  updated_at?: string;
  is_deleted?: boolean;
  item_data?: {
    name?: string;
    /** The options (Willo Ranch: "Lot #") whose values tell the item's variations apart. */
    item_options?: Array<{ item_option_id?: string }>;
    variations?: SquareVariationObject[];
  };
  measurement_unit_data?: { measurement_unit?: { weight_unit?: string; custom_unit?: { name?: string } }; precision?: number };
  item_option_data?: { name?: string; display_name?: string; values?: Array<{ id: string; is_deleted?: boolean; item_option_value_data?: { item_option_id?: string; name?: string } }> };
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
          // Since Square-Version 2026-07-15 an adjustment names its location on both sides; location_id is gone.
          from_location_id: a.locationId,
          to_location_id: a.locationId,
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

/** Where a Square inventory change came from. */
export interface SquareSource {
  /** SQUARE_POS, EXTERNAL_API, BILLING, APPOINTMENTS, INVOICES, ONLINE_STORE, PAYROLL, DASHBOARD, ITEM_LIBRARY_IMPORT or OTHER. */
  product?: string;
  application_id?: string;
  name?: string;
}

/** One entry of Square's inventory history, as the ranch bridge reads it. */
export interface SquareInventoryChange {
  type: "ADJUSTMENT" | "PHYSICAL_COUNT" | "TRANSFER";
  adjustment?: {
    id: string;
    reference_id?: string;
    from_state?: string;
    to_state?: string;
    from_location_id?: string;
    to_location_id?: string;
    /** Versions before 2026-07-15. */
    location_id?: string;
    catalog_object_id?: string;
    quantity?: string;
    occurred_at?: string;
    created_at?: string;
    source?: SquareSource;
    transaction_id?: string;
    refund_id?: string;
    /** Set when a recount produced this adjustment; the count itself is reported separately. */
    physical_count_id?: string;
  };
  physical_count?: {
    id: string;
    reference_id?: string;
    catalog_object_id?: string;
    state?: string;
    location_id?: string;
    quantity?: string;
    occurred_at?: string;
    created_at?: string;
    source?: SquareSource;
  };
}

/**
 * Square's inventory history (adjustments and recounts, oldest first) at the
 * given locations, calculated after `updatedAfter`. Used to learn about counter
 * sales one by one rather than as a changed total.
 */
export async function listInventoryChanges(environment: SquareEnvironment, token: string, input: { locationIds: string[]; updatedAfter: string; catalogObjectIds?: string[] }): Promise<SquareInventoryChange[]> {
  const out: SquareInventoryChange[] = [];
  const groups = input.catalogObjectIds ? Array.from({ length: Math.ceil(input.catalogObjectIds.length / 500) }, (_, i) => input.catalogObjectIds!.slice(i * 500, i * 500 + 500)) : [undefined];
  for (const ids of groups) {
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const data = await api<{ changes?: SquareInventoryChange[]; cursor?: string }>(environment, token, "POST", "inventory/changes/batch-retrieve", {
        location_ids: input.locationIds,
        ...(ids ? { catalog_object_ids: ids } : {}),
        types: ["ADJUSTMENT", "PHYSICAL_COUNT"],
        updated_after: input.updatedAfter,
        limit: 1000,
        cursor,
      });
      out.push(...(data.changes ?? []));
      cursor = data.cursor;
      if (!cursor) break;
    }
  }
  return out;
}

export interface SquareCountSet {
  variationId: string;
  locationId: string;
  /** The count Square should show, in the variation's unit. */
  quantity: number;
  occurredAt: string;
  referenceId?: string;
}

/**
 * Sets Square's in-stock count outright (PHYSICAL_COUNT), in one call per 100.
 * Repeating the same count is harmless, which is why a bridge that owns the
 * numbers prefers it to adjustments.
 */
export async function setInventoryCounts(environment: SquareEnvironment, token: string, counts: SquareCountSet[], idempotencyKey: string): Promise<void> {
  for (let i = 0; i < counts.length; i += 100) {
    const chunk = counts.slice(i, i + 100);
    await api(environment, token, "POST", "inventory/changes/batch-create", {
      idempotency_key: `${idempotencyKey}-${i / 100}`.slice(0, 128),
      ignore_unchanged_counts: true,
      changes: chunk.map((c) => ({
        type: "PHYSICAL_COUNT",
        physical_count: {
          catalog_object_id: c.variationId,
          catalog_object_type: "ITEM_VARIATION",
          location_id: c.locationId,
          state: "IN_STOCK",
          quantity: squareQuantity(Math.max(0, c.quantity)),
          occurred_at: c.occurredAt,
          ...(c.referenceId ? { reference_id: c.referenceId.slice(0, 255) } : {}),
        },
      })),
    });
  }
}

/**
 * Creates or updates catalog objects in one batch. Objects may refer to each
 * other by "#client" ids; the returned map turns those into Square's ids.
 */
export async function upsertCatalogObjects(environment: SquareEnvironment, token: string, objects: Array<Record<string, unknown>>, idempotencyKey: string): Promise<Map<string, string>> {
  const data = await api<{ id_mappings?: Array<{ client_object_id?: string; object_id?: string }> }>(environment, token, "POST", "catalog/batch-upsert", {
    idempotency_key: idempotencyKey.slice(0, 128),
    batches: [{ objects }],
  });
  return new Map((data.id_mappings ?? []).filter((m) => m.client_object_id && m.object_id).map((m) => [m.client_object_id!, m.object_id!]));
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
