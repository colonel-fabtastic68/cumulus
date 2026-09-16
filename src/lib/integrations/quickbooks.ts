import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { decideToken, expiryTimes, isInvalidGrant, stateIsValid, type OAuthState } from "@/lib/server/quickbooksRules";
import { HttpError, USER_AGENT, fetchJson, readSecrets, writeSecrets, type Secrets, type ServerContext } from "./server";

/**
 * QuickBooks Online: OAuth 2.0 (authorization code) plus the v3 accounting
 * API. Endpoints come from Intuit's discovery document at request time,
 * tokens live in `workspaces/{ws}/secrets/quickbooks`, and every API call
 * goes through `withToken`, which refreshes before expiry and once more on a
 * 401 before asking the customer to reconnect.
 */

export type QboEnvironment = "sandbox" | "production";

export interface QboConfig {
  clientId: string;
  clientSecret: string;
  environment: QboEnvironment;
}

export const QBO_SCOPE = "com.intuit.quickbooks.accounting";
export const QBO_MINOR_VERSION = "75";
export const OAUTH_STATES = "oauthStates";

/** Env values pasted with surrounding quotes or a "Client ID:" label still work. */
function envValue(name: string): string {
  return (process.env[name] ?? "").trim().replace(/^["']+|["']+$/g, "").replace(/^[A-Za-z ]+:\s*/, "").trim();
}

export function quickbooksConfig(): QboConfig | null {
  const clientId = envValue("QUICKBOOKS_CLIENT_ID");
  const clientSecret = envValue("QUICKBOOKS_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;
  const environment: QboEnvironment = /^prod/i.test(envValue("QUICKBOOKS_ENVIRONMENT")) ? "production" : "sandbox";
  return { clientId, clientSecret, environment };
}

export function requireQuickbooksConfig(): QboConfig {
  const config = quickbooksConfig();
  if (!config) throw new HttpError(503, "QuickBooks is not configured on this server. Add QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET to the deployment's environment.");
  // Intuit ids and secrets are plain tokens; anything else is a paste gone wrong and Intuit would answer "client_id missing".
  if (!/^[A-Za-z0-9]{20,}$/.test(config.clientId)) throw new HttpError(503, "QUICKBOOKS_CLIENT_ID does not look like an Intuit client id (letters and digits only, no quotes or spaces). Copy it again from Keys & credentials in the Intuit developer portal.");
  if (/\s/.test(config.clientSecret) || config.clientSecret.length < 20) throw new HttpError(503, "QUICKBOOKS_CLIENT_SECRET does not look like an Intuit client secret. Copy it again from Keys & credentials in the Intuit developer portal.");
  return config;
}

export function apiBase(environment: QboEnvironment): string {
  return environment === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
}

// ---- discovery -------------------------------------------------------------------

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint: string;
}

/** Last-resort values, matching the document as of 2026-09; the live document wins whenever it can be read. */
const FALLBACK: Discovery = {
  authorization_endpoint: "https://appcenter.intuit.com/connect/oauth2",
  token_endpoint: "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
  revocation_endpoint: "https://developer.api.intuit.com/v2/oauth2/tokens/revoke",
};

const discoveryCache: Partial<Record<QboEnvironment, { doc: Discovery; fetchedAt: number }>> = {};
const DISCOVERY_TTL_MS = 24 * 3_600_000;

/** Intuit's OpenID discovery document, cached per process for a day. */
export async function discover(environment: QboEnvironment): Promise<Discovery> {
  const cached = discoveryCache[environment];
  if (cached && Date.now() - cached.fetchedAt < DISCOVERY_TTL_MS) return cached.doc;
  const url = environment === "production" ? "https://developer.api.intuit.com/.well-known/openid_configuration" : "https://developer.api.intuit.com/.well-known/openid_sandbox_configuration";
  try {
    const { data } = await fetchJson<Partial<Discovery>>(url, { timeoutMs: 8_000 });
    const doc: Discovery = {
      authorization_endpoint: data.authorization_endpoint || FALLBACK.authorization_endpoint,
      token_endpoint: data.token_endpoint || FALLBACK.token_endpoint,
      revocation_endpoint: data.revocation_endpoint || FALLBACK.revocation_endpoint,
    };
    discoveryCache[environment] = { doc, fetchedAt: Date.now() };
    return doc;
  } catch (e) {
    console.warn("[quickbooks] discovery document unavailable, using fallback endpoints:", e instanceof Error ? e.message : e);
    return FALLBACK;
  }
}

// ---- authorisation ------------------------------------------------------------------

export function redirectUri(base: string): string {
  return `${base}/api/integrations/quickbooks/callback`;
}

/** Stores a single-use state for this workspace and returns the URL to send the browser to. */
export async function beginAuthorization(ctx: Pick<ServerContext, "db" | "workspaceId" | "actor">, base: string, config = requireQuickbooksConfig()): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  const doc: OAuthState = { workspaceId: ctx.workspaceId, uid: ctx.actor.id, provider: "quickbooks", createdAt: new Date().toISOString() };
  await ctx.db.doc(`${OAUTH_STATES}/${state}`).set(doc);
  const { authorization_endpoint } = await discover(config.environment);
  const url = new URL(authorization_endpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", QBO_SCOPE);
  url.searchParams.set("redirect_uri", redirectUri(base));
  url.searchParams.set("state", state);
  return url.toString();
}

/** Redeems the state Intuit sent back. Each state works once and expires after ten minutes. */
export async function consumeState(db: Firestore, state: string): Promise<OAuthState> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(state)) throw new HttpError(400, "The QuickBooks sign-in did not come from this app (bad state).");
  const ref = db.doc(`${OAUTH_STATES}/${state}`);
  const found = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    tx.delete(ref);
    return snap.data() as OAuthState;
  });
  if (!stateIsValid(found, "quickbooks")) throw new HttpError(400, "The QuickBooks sign-in expired or was already used. Start again from the Integrations page.");
  return found!;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
  token_type: string;
}

async function tokenRequest(config: QboConfig, params: Record<string, string>): Promise<TokenResponse> {
  const { token_endpoint } = await discover(config.environment);
  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: { Authorization: basicAuth(config), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": USER_AGENT },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: Partial<TokenResponse> & { error?: string; error_description?: string } = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok || !data.access_token || !data.refresh_token) {
    if (isInvalidGrant(data.error, res.status)) throw new HttpError(401, "QuickBooks no longer accepts this connection. Reconnect to QuickBooks to keep syncing.", "invalid_grant");
    throw new HttpError(502, `QuickBooks did not issue a token (${res.status}${data.error ? ` ${data.error}` : ""}${data.error_description ? `: ${data.error_description}` : ""}).`, data.error);
  }
  return data as TokenResponse;
}

function basicAuth(config: QboConfig): string {
  return `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
}

/** Turns the authorisation code into the secrets we keep for this workspace. */
export async function exchangeCode(config: QboConfig, code: string, base: string, realmId: string): Promise<Secrets> {
  const t = await tokenRequest(config, { grant_type: "authorization_code", code, redirect_uri: redirectUri(base) });
  return tokenSecrets(t, realmId, config.environment);
}

function tokenSecrets(t: TokenResponse, realmId: string, environment: QboEnvironment): Secrets {
  const times = expiryTimes(t.expires_in, t.x_refresh_token_expires_in);
  return { accessToken: t.access_token, refreshToken: t.refresh_token, accessExpiresAt: times.accessExpiresAt, refreshExpiresAt: times.refreshExpiresAt, realmId, environment };
}

/** Refreshes with retry on transient failures; the rotated refresh token replaces the old one at once. */
async function refreshTokens(ctx: Pick<ServerContext, "db" | "workspaceId">, config: QboConfig, secrets: Secrets): Promise<Secrets> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const t = await tokenRequest(config, { grant_type: "refresh_token", refresh_token: secrets.refreshToken });
      const next = { ...secrets, ...tokenSecrets(t, secrets.realmId, config.environment) };
      await writeSecrets(ctx, "quickbooks", next);
      return next;
    } catch (e) {
      lastError = e;
      // Permanent answers (invalid_grant) are not retried; a network blip or 5xx gets one more go.
      if (e instanceof HttpError && (e.status === 401 || e.code === "invalid_grant")) throw e;
      await new Promise((r) => setTimeout(r, 800));
    }
  }
  throw lastError;
}

/** Revokes the refresh token (which also kills the access token) so the company sees the app disconnected. */
export async function revoke(config: QboConfig, secrets: Secrets): Promise<void> {
  const { revocation_endpoint } = await discover(config.environment);
  await fetch(revocation_endpoint, {
    method: "POST",
    headers: { Authorization: basicAuth(config), "Content-Type": "application/json", Accept: "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ token: secrets.refreshToken }),
    signal: AbortSignal.timeout(15_000),
  });
}

/**
 * Runs `fn` with a live access token: refreshes first when the token is near
 * expiry, and once more if QuickBooks still answers 401. Marks the integration
 * as needing a reconnect when the refresh token itself is dead.
 */
export async function withToken<T>(ctx: ServerContext, secrets: Secrets, fn: (accessToken: string, realmId: string) => Promise<T>): Promise<T> {
  const config = requireQuickbooksConfig();
  let current = secrets;
  if (!current.refreshToken || !current.realmId) throw await needsReconnect(ctx, "QuickBooks credentials are incomplete; connect it again.");
  const decision = decideToken({ accessExpiresAt: current.accessExpiresAt ?? "", refreshExpiresAt: current.refreshExpiresAt ?? "" });
  if (decision === "reconnect") throw await needsReconnect(ctx, "The QuickBooks connection expired (refresh tokens last about 100 days). Reconnect to keep syncing.");
  try {
    if (decision === "refresh") current = await refreshTokens(ctx, config, current);
    try {
      return await fn(current.accessToken, current.realmId);
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 401)) throw e;
      current = await refreshTokens(ctx, config, current);
      return await fn(current.accessToken, current.realmId);
    }
  } catch (e) {
    if (e instanceof HttpError && (e.code === "invalid_grant" || e.status === 401)) throw await needsReconnect(ctx, e.message);
    throw e;
  }
}

async function needsReconnect(ctx: ServerContext, message: string): Promise<HttpError> {
  try {
    await ctx.store.patch("integrations", "quickbooks", { status: "error", lastError: message });
  } catch {
    // The caller still gets the error even if the status could not be recorded.
  }
  return new HttpError(401, message, "invalid_grant");
}

// ---- API ------------------------------------------------------------------------

export interface QboCompany {
  CompanyName: string;
  LegalName?: string;
  Country?: string;
  CompanyAddr?: { City?: string; CountrySubDivisionCode?: string };
}

export interface QboItem {
  Id: string;
  Name: string;
  FullyQualifiedName?: string;
  Sku?: string;
  Description?: string;
  Type: "Inventory" | "NonInventory" | "Service" | "Group" | "Category";
  Active: boolean;
  UnitPrice?: number;
  PurchaseCost?: number;
  QtyOnHand?: number;
  ReorderPoint?: number;
  SubItem?: boolean;
  ParentRef?: { name?: string; value: string };
  MetaData?: { LastUpdatedTime?: string };
}

async function apiGet<T>(environment: QboEnvironment, accessToken: string, realmId: string, path: string, query: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${apiBase(environment)}/v3/company/${encodeURIComponent(realmId)}/${path}`);
  url.searchParams.set("minorversion", QBO_MINOR_VERSION);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const { data } = await fetchJson<T>(url.toString(), { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  return data;
}

export async function companyInfo(environment: QboEnvironment, accessToken: string, realmId: string): Promise<QboCompany> {
  const data = await apiGet<{ CompanyInfo: QboCompany }>(environment, accessToken, realmId, `companyinfo/${encodeURIComponent(realmId)}`);
  if (!data?.CompanyInfo?.CompanyName) throw new HttpError(502, "QuickBooks did not return the company details.");
  return data.CompanyInfo;
}

/** Every product and service (active and inactive), 1000 a page, so items renamed or deactivated in QuickBooks are seen too. */
export async function listItems(environment: QboEnvironment, accessToken: string, realmId: string): Promise<QboItem[]> {
  const out: QboItem[] = [];
  const pageSize = 1000;
  for (let start = 1; start < 100_000; start += pageSize) {
    const query = `SELECT * FROM Item WHERE Active IN (true, false) STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
    const data = await apiGet<{ QueryResponse?: { Item?: QboItem[] } }>(environment, accessToken, realmId, "query", { query });
    const page = data?.QueryResponse?.Item ?? [];
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

/** Reads the stored secrets and confirms the connection still works, returning the company for the card. */
export async function verifyConnection(ctx: ServerContext): Promise<{ company: QboCompany; secrets: Secrets }> {
  const secrets = await readSecrets(ctx, "quickbooks");
  if (!secrets?.refreshToken) throw new HttpError(409, "QuickBooks is not connected yet. Use Connect to QuickBooks first.");
  const environment = (secrets.environment as QboEnvironment | undefined) ?? requireQuickbooksConfig().environment;
  const company = await withToken(ctx, secrets, (token, realmId) => companyInfo(environment, token, realmId));
  return { company, secrets };
}
