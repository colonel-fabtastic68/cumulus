/**
 * The rules for the emailed code that follows a password at sign-in, kept free
 * of Firebase so they can be tested on their own.
 *
 * A session is one sign-in on one device. Firebase stamps it with `auth_time`,
 * which survives token refreshes and changes with every new sign-in, so the
 * server remembers which auth_times have had their code entered. A password
 * alone gives a session that is not on the list.
 */

/** What a password session hears from every route until it has entered its code. */
export const SIGN_IN_CODE_PENDING = "Enter the sign-in code we emailed you to finish signing in.";
/** Fired in the browser when a route answers with that refusal, so the session sends the person to the code page. */
export const SIGN_IN_CODE_EVENT = "cumulus:sign-in-code-pending";

/** How many verified sessions are remembered per account; the oldest drop off and are asked for a code again. */
export const MAX_REMEMBERED_SESSIONS = 20;

export interface SignInSessionsState {
  /** auth_time (seconds) of each session that entered its code, oldest first. */
  verified?: number[];
}

/**
 * Only password sessions are asked. An emailed sign-in link already proves the
 * inbox, guests have no address, and a session with no address cannot be mailed.
 */
export function signInCodeApplies(token: { signInProvider?: string; email?: string }): boolean {
  return token.signInProvider === "password" && !!token.email;
}

export function sessionVerified(state: SignInSessionsState | null | undefined, authTime: number): boolean {
  return authTime > 0 && (state?.verified ?? []).includes(authTime);
}

export function rememberSession(state: SignInSessionsState | null | undefined, authTime: number): number[] {
  const rest = (state?.verified ?? []).filter((t) => typeof t === "number" && t !== authTime);
  return [...rest, authTime].slice(-MAX_REMEMBERED_SESSIONS);
}
