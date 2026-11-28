import type { Firestore } from "firebase-admin/firestore";
import { serverFeatureEnabled } from "@/lib/features";
import type { InstanceDef } from "@/lib/instances";
import { emailCodesConfigured } from "./emailCodes";
import { rememberSession, sessionVerified, signInCodeApplies, type SignInSessionsState } from "./signInCodeRules";

/**
 * The second step of signing in: after the password, a 6-digit code emailed to
 * the account. Verified sessions are listed in `signInSessions/{uid}` (server
 * only; the rules match no such path, so browsers are refused). The code itself
 * is issued and checked by emailCodes.ts, the same way as for a new account.
 */

/** On where codes can be mailed and the feature is switched on. A bespoke instance's operator creates its accounts, so it is left alone. */
export function signInCodesOn(instance: InstanceDef | null): boolean {
  return !instance && emailCodesConfigured() && serverFeatureEnabled("signInCodes");
}

const sessionsRef = (db: Firestore, uid: string) => db.doc(`signInSessions/${uid}`);

/** Sessions this server instance has already seen verified; a verified session never becomes unverified, so only hits are kept. */
const seen = new Set<string>();
const MAX_SEEN = 5000;

function remember(uid: string, authTime: number) {
  if (seen.size >= MAX_SEEN) seen.clear();
  seen.add(`${uid}:${authTime}`);
}

export type SecondStep = "not-required" | "verified" | "pending";

/** Where a verified ID token stands: no code needed, code entered, or still waiting for it. */
export async function secondStepFor(db: Firestore, token: { uid: string; authTime: number; signInProvider?: string; email?: string }, instance: InstanceDef | null): Promise<SecondStep> {
  if (!signInCodesOn(instance) || !signInCodeApplies(token)) return "not-required";
  if (seen.has(`${token.uid}:${token.authTime}`)) return "verified";
  const snap = await sessionsRef(db, token.uid).get();
  if (!sessionVerified(snap.exists ? (snap.data() as SignInSessionsState) : null, token.authTime)) return "pending";
  remember(token.uid, token.authTime);
  return "verified";
}

export async function markSessionVerified(db: Firestore, uid: string, authTime: number): Promise<void> {
  if (authTime <= 0) return;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(sessionsRef(db, uid));
    tx.set(sessionsRef(db, uid), { verified: rememberSession(snap.exists ? (snap.data() as SignInSessionsState) : null, authTime) } satisfies SignInSessionsState);
  });
  remember(uid, authTime);
}
