/**
 * Pure decisions for the QuickBooks OAuth connection: when a token needs
 * refreshing, whether an authorization state is still valid, and how Intuit's
 * OAuth errors map to what we tell the customer. Kept free of I/O so it can be
 * unit-tested without Firestore or Intuit.
 */

/** Intuit access tokens last 3600 s; refresh this long before the edge so an in-flight call never lands on a dead token. */
export const ACCESS_REFRESH_MARGIN_MS = 5 * 60_000;
/** An authorization attempt (the `state` we hand Intuit) is honored for this long. */
export const STATE_TTL_MS = 10 * 60_000;

export interface TokenTimes {
  /** ISO time the access token stops working. */
  accessExpiresAt: string;
  /** ISO time the refresh token stops working (about 100 days; Intuit rotates the value roughly daily). */
  refreshExpiresAt: string;
}

export type TokenDecision = "use" | "refresh" | "reconnect";

/** What to do before an API call: use the token, refresh it first, or give up because the refresh token is gone too. */
export function decideToken(times: TokenTimes, now = Date.now()): TokenDecision {
  const refreshEnd = Date.parse(times.refreshExpiresAt);
  if (!Number.isFinite(refreshEnd) || refreshEnd <= now) return "reconnect";
  const accessEnd = Date.parse(times.accessExpiresAt);
  if (!Number.isFinite(accessEnd) || accessEnd - now <= ACCESS_REFRESH_MARGIN_MS) return "refresh";
  return "use";
}

export interface OAuthState {
  workspaceId: string;
  uid: string;
  provider: string;
  createdAt: string;
}

/** A callback is accepted only for a state we issued, for this provider, less than STATE_TTL_MS ago. */
export function stateIsValid(state: OAuthState | null | undefined, provider: string, now = Date.now()): boolean {
  if (!state || state.provider !== provider) return false;
  const created = Date.parse(state.createdAt);
  return Number.isFinite(created) && created <= now && now - created < STATE_TTL_MS;
}

/** True when Intuit says the refresh token is dead or revoked: the only fix is the customer reconnecting. */
export function isInvalidGrant(error: string | undefined, status: number): boolean {
  return error === "invalid_grant" || error === "invalid_client" || (status === 400 && !error);
}

/** Token responses from Intuit's bearer endpoint, in seconds. */
export function expiryTimes(expiresIn: number, refreshExpiresIn: number, now = Date.now()): TokenTimes {
  return { accessExpiresAt: new Date(now + expiresIn * 1000).toISOString(), refreshExpiresAt: new Date(now + refreshExpiresIn * 1000).toISOString() };
}
