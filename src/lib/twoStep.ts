/**
 * Two-step sign-in by email: the rules shared by the browser, the server and
 * (in their own words) firestore.rules. Kept free of Firebase so they can be
 * checked on their own.
 *
 * Firebase's built-in multi-factor sign-in offers text messages and
 * authenticator apps, not email, so the second step lives in two custom claims
 * on the account, set only by the server:
 *
 * - `twoStep: "email"`  the person turned two-step sign-in on;
 * - `twoStepAuth: [..]` the `auth_time` of each sign-in that has entered a code.
 *
 * Every Firebase sign-in gets a new `auth_time`, which token refreshes keep, so
 * a sign-in whose `auth_time` is not on the list has only passed the first
 * step. firestore.rules refuses such a token everywhere, and the server's API
 * routes refuse it everywhere except the two-step routes themselves.
 */

export const TWO_STEP_CLAIM = "twoStep";
export const TWO_STEP_SESSIONS_CLAIM = "twoStepAuth";
/** Sign-ins remembered per account. A device whose sign-in falls off the list asks for a new code. */
export const TWO_STEP_MAX_SESSIONS = 10;

export type TwoStepPurpose = "sign-in" | "enable" | "disable";

export const TWO_STEP_PURPOSES: readonly TwoStepPurpose[] = ["sign-in", "enable", "disable"];

export function isTwoStepPurpose(value: unknown): value is TwoStepPurpose {
  return typeof value === "string" && (TWO_STEP_PURPOSES as readonly string[]).includes(value);
}

export interface TwoStepState {
  /** Two-step sign-in is on for the account. */
  enabled: boolean;
  /** This sign-in has passed the second step (always true when two-step is off). */
  verified: boolean;
}

function sessions(claims: Record<string, unknown>): number[] {
  const raw = claims[TWO_STEP_SESSIONS_CLAIM];
  return Array.isArray(raw) ? raw.filter((t): t is number => typeof t === "number" && Number.isFinite(t)) : [];
}

/** Reads the state from a decoded ID token: its custom claims and its `auth_time` (seconds). */
export function twoStepFromClaims(claims: Record<string, unknown>, authTime: number): TwoStepState {
  const enabled = claims[TWO_STEP_CLAIM] === "email";
  if (!enabled) return { enabled: false, verified: true };
  return { enabled: true, verified: sessions(claims).includes(authTime) };
}

/** True when the sign-in still owes its emailed code. */
export function twoStepPending(state: TwoStepState): boolean {
  return state.enabled && !state.verified;
}

/** The account's claims with two-step on and this sign-in counted as verified. Other claims are kept. */
export function claimsWithVerifiedSignIn(claims: Record<string, unknown>, authTime: number): Record<string, unknown> {
  const kept = sessions(claims).filter((t) => t !== authTime);
  const next = [...kept, authTime].slice(-TWO_STEP_MAX_SESSIONS);
  return { ...claims, [TWO_STEP_CLAIM]: "email", [TWO_STEP_SESSIONS_CLAIM]: next };
}

/** The account's claims with two-step sign-in off. Other claims are kept. */
export function claimsWithoutTwoStep(claims: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...claims };
  delete rest[TWO_STEP_CLAIM];
  delete rest[TWO_STEP_SESSIONS_CLAIM];
  return rest;
}

/** What the server will do with a code request, given the account's state. Null means go ahead. */
export function twoStepRefusal(purpose: TwoStepPurpose, state: TwoStepState): string | null {
  if (purpose === "sign-in" && !state.enabled) return "Two-step sign-in is off for this account.";
  if (purpose === "enable" && state.enabled) return "Two-step sign-in is already on.";
  if (purpose === "disable" && !state.enabled) return "Two-step sign-in is already off.";
  if (purpose !== "sign-in" && !state.verified) return "Finish signing in with your emailed code first.";
  return null;
}
