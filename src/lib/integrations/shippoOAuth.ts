import { randomBytes } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import type { OAuthState } from "@/lib/server/quickbooksRules";
import { consumeState, OAUTH_STATES } from "./quickbooks";
import { HttpError, USER_AGENT, type ServerContext } from "./server";

/**
 * Shippo's gray-label OAuth: the merchant keeps their own Shippo account and
 * billing, signs in on goshippo.com, and cumulusOS receives a long-lived
 * bearer token in place of a pasted API key. Shippo issues the client
 * credentials once given our callback URL.
 */

export interface ShippoOAuthConfig {
  clientId: string;
  clientSecret: string;
}

function envValue(name: string): string {
  return (process.env[name] ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
}

export function shippoOAuthConfig(): ShippoOAuthConfig | null {
  const clientId = envValue("SHIPPO_CLIENT_ID");
  const clientSecret = envValue("SHIPPO_CLIENT_SECRET");
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function requireShippoOAuthConfig(): ShippoOAuthConfig {
  const config = shippoOAuthConfig();
  if (!config) throw new HttpError(503, "Shippo sign-in is not configured on this server. Add SHIPPO_CLIENT_ID and SHIPPO_CLIENT_SECRET to the deployment's environment, or paste an API token instead.");
  return config;
}

export function shippoRedirectUri(base: string): string {
  return `${base}/api/integrations/shippo/callback`;
}

/** Stores a single-use state for this workspace and returns Shippo's consent URL. */
export async function beginShippoAuthorization(ctx: Pick<ServerContext, "db" | "workspaceId" | "actor">, base: string, config = requireShippoOAuthConfig()): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  const doc: OAuthState = { workspaceId: ctx.workspaceId, uid: ctx.actor.id, provider: "shippo", createdAt: new Date().toISOString() };
  await ctx.db.doc(`${OAUTH_STATES}/${state}`).set(doc);
  const url = new URL("https://goshippo.com/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("scope", "*");
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", shippoRedirectUri(base));
  return url.toString();
}

export function consumeShippoState(db: Firestore, state: string): Promise<OAuthState> {
  return consumeState(db, state, "shippo");
}

/** Exchanges the authorization code for the merchant's bearer token (Shippo's do not expire). */
export async function exchangeShippoCode(config: ShippoOAuthConfig, code: string): Promise<string> {
  const res = await fetch("https://goshippo.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", "User-Agent": USER_AGENT },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, grant_type: "authorization_code" }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: { access_token?: string; error?: string; error_description?: string } = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok || !data.access_token) throw new HttpError(502, `Shippo did not issue a token (${res.status}${data.error ? ` ${data.error}` : ""}${data.error_description ? `: ${data.error_description}` : ""}).`);
  return data.access_token;
}
