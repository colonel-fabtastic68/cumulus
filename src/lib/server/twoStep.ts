import type { Firestore } from "firebase-admin/firestore";
import type { ServiceAccount } from "@/lib/mcp/adminStore";
import { HttpError } from "@/lib/integrations/server";
import type { TwoStepPurpose } from "@/lib/twoStep";
import { CODE_TTL_MS, decideSend, decideVerify, generateCode, hashCode, type EmailCodeState } from "./emailCodeRules";
import { pepper, sendCodeEmail, serviceAccessToken, type CodeEmailWording } from "./emailCodes";

/**
 * Two-step sign-in by email, server side (the rules are in src/lib/twoStep.ts).
 * Codes live hashed in `twoStepCodes/{uid}` (no rule opens it to browsers),
 * one at a time per account. A code is bound to what it is for and to the
 * sign-in that asked for it (`auth_time`), so a code mailed for one device
 * cannot finish another device's sign-in. The resend and retry limits are the
 * sign-up code's (emailCodeRules.ts).
 */

interface TwoStepCodeState extends EmailCodeState {
  purpose: TwoStepPurpose;
  authTime: number;
}

const codeRef = (db: Firestore, uid: string) => db.doc(`twoStepCodes/${uid}`);

/** What the hash binds the code to. */
function subject(uid: string, purpose: TwoStepPurpose, authTime: number): string {
  return `${uid}:two-step:${purpose}:${authTime}`;
}

const WORDING: Record<TwoStepPurpose, CodeEmailWording> = {
  "sign-in": {
    lead: "Your cumulusOS sign-in code is",
    note: "It expires in 10 minutes. Someone, hopefully you, signed in to your cumulusOS account with your password. If that wasn't you, change your password now: the code alone keeps them out.",
  },
  enable: {
    lead: "Your code to turn on two-step sign-in is",
    note: "It expires in 10 minutes. If you didn't ask for this, you can ignore this email.",
  },
  disable: {
    lead: "Your code to turn off two-step sign-in is",
    note: "It expires in 10 minutes. If you didn't ask for this, someone is signed in to your account: change your password and keep two-step sign-in on.",
  },
};

export type TwoStepIssueResult = { sent: true } | { sent: false; retryAfterMs: number; reason: "cooldown" | "hourly" };

export async function issueTwoStepCode(db: Firestore, sa: ServiceAccount, uid: string, email: string, purpose: TwoStepPurpose, authTime: number, now = Date.now()): Promise<TwoStepIssueResult> {
  const code = generateCode();
  const decision = await db.runTransaction(async (tx) => {
    const snap = await tx.get(codeRef(db, uid));
    const state = snap.exists ? (snap.data() as TwoStepCodeState) : null;
    // The hourly limit counts every code sent to the address; the one-minute wait only applies to asking again for the same thing.
    const same = !!state && state.email === email && state.purpose === purpose && state.authTime === authTime;
    const forLimits = state && state.email === email ? { ...state, sentAt: same ? state.sentAt : 0 } : null;
    const d = decideSend(forLimits, now);
    if (d.ok) {
      const next: TwoStepCodeState = { hash: hashCode(code, subject(uid, purpose, authTime), pepper(sa)), email, expiresAt: now + CODE_TTL_MS, attempts: 0, sentAt: now, sends: d.sends, purpose, authTime };
      tx.set(codeRef(db, uid), next);
    }
    return d;
  });
  if (!decision.ok) return { sent: false, retryAfterMs: decision.retryAfterMs, reason: decision.reason };
  try {
    await sendCodeEmail(email, code, WORDING[purpose]);
  } catch (e) {
    await codeRef(db, uid).update({ sentAt: 0 }).catch(() => {});
    throw e;
  }
  return { sent: true };
}

/** Throws with a plain message unless the code matches this purpose and this sign-in; wrong guesses are counted. */
export async function checkTwoStepCode(db: Firestore, sa: ServiceAccount, uid: string, code: string, purpose: TwoStepPurpose, authTime: number, now = Date.now()): Promise<void> {
  const decision = await db.runTransaction(async (tx) => {
    const snap = await tx.get(codeRef(db, uid));
    const state = snap.exists ? (snap.data() as TwoStepCodeState) : null;
    const matching = state && state.purpose === purpose && state.authTime === authTime ? state : null;
    const d = decideVerify(matching, code, subject(uid, purpose, authTime), pepper(sa), now);
    if (!d.ok && d.attempts !== undefined) tx.update(codeRef(db, uid), { attempts: d.attempts });
    return d;
  });
  if (!decision.ok) throw new HttpError(decision.status, decision.message);
}

export async function clearTwoStepCode(db: Firestore, uid: string): Promise<void> {
  await codeRef(db, uid).delete().catch(() => {});
}

// ---- custom claims, through the Identity Toolkit API (firebase-admin/auth cannot load on Vercel) ----

const TOOLKIT = "https://identitytoolkit.googleapis.com/v1/projects";

async function toolkit<T>(sa: ServiceAccount, action: "lookup" | "update", body: Record<string, unknown>): Promise<T> {
  const token = await serviceAccessToken(sa);
  const res = await fetch(`${TOOLKIT}/${encodeURIComponent(sa.project_id)}/accounts:${action}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`[two-step] accounts:${action} failed`, res.status, (await res.text().catch(() => "")).slice(0, 300));
    throw new HttpError(502, "Your account could not be updated just now. Try again in a minute.");
  }
  return (await res.json()) as T;
}

/** The account's custom claims as stored (not as a possibly older ID token carries them). */
export async function readCustomClaims(sa: ServiceAccount, uid: string, tenantId?: string): Promise<Record<string, unknown>> {
  const data = await toolkit<{ users?: Array<{ customAttributes?: string }> }>(sa, "lookup", { localId: [uid], ...(tenantId ? { tenantId } : {}) });
  const raw = data.users?.[0]?.customAttributes;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Replaces the account's custom claims. The browser picks them up on its next token refresh. */
export async function writeCustomClaims(sa: ServiceAccount, uid: string, claims: Record<string, unknown>, tenantId?: string): Promise<void> {
  const json = JSON.stringify(claims);
  // Firebase's limit for custom claims.
  if (json.length > 1000) throw new HttpError(500, "The account's settings are too large to save.");
  await toolkit(sa, "update", { localId: uid, customAttributes: json, ...(tenantId ? { tenantId } : {}) });
}
