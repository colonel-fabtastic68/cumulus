import { createHmac } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { adminApp, type ServiceAccount } from "@/lib/mcp/adminStore";
import { HttpError } from "@/lib/integrations/server";
import { CODE_TTL_MS, decideSend, decideVerify, generateCode, hashCode, type EmailCodeState } from "./emailCodeRules";

/**
 * One-time codes for new sign-ups. Codes are stored hashed in `emailCodes/{uid}`
 * (server only; the rules deny browsers), mailed through Resend, and a correct
 * code marks the Firebase account's email as verified.
 */
export function emailCodesConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

/** Derived from the service account key, so a leaked hash cannot be brute-forced without server secrets. */
function pepper(sa: ServiceAccount): string {
  return createHmac("sha256", sa.private_key).update("cumulusos-email-code-v1").digest("hex");
}

const codeRef = (db: Firestore, uid: string) => db.doc(`emailCodes/${uid}`);

export type IssueResult = { sent: true } | { sent: false; retryAfterMs: number; reason: "cooldown" | "hourly" };

export async function issueCode(db: Firestore, sa: ServiceAccount, uid: string, email: string, now = Date.now()): Promise<IssueResult> {
  const code = generateCode();
  const decision = await db.runTransaction(async (tx) => {
    const snap = await tx.get(codeRef(db, uid));
    const state = snap.exists ? (snap.data() as EmailCodeState) : null;
    const d = decideSend(state && state.email === email ? state : null, now);
    if (d.ok) {
      const next: EmailCodeState = { hash: hashCode(code, uid, pepper(sa)), email, expiresAt: now + CODE_TTL_MS, attempts: 0, sentAt: now, sends: d.sends };
      tx.set(codeRef(db, uid), next);
    }
    return d;
  });
  if (!decision.ok) return { sent: false, retryAfterMs: decision.retryAfterMs, reason: decision.reason };
  try {
    await sendCodeEmail(email, code);
  } catch (e) {
    // Let the person ask again straight away; the failed send still counts toward the hourly limit.
    await codeRef(db, uid).update({ sentAt: 0 }).catch(() => {});
    throw e;
  }
  return { sent: true };
}

/** Throws with a plain message unless the code matches; wrong guesses are counted. */
export async function checkCode(db: Firestore, sa: ServiceAccount, uid: string, code: string, now = Date.now()): Promise<void> {
  const decision = await db.runTransaction(async (tx) => {
    const snap = await tx.get(codeRef(db, uid));
    const d = decideVerify(snap.exists ? (snap.data() as EmailCodeState) : null, code, uid, pepper(sa), now);
    if (!d.ok && d.attempts !== undefined) tx.update(codeRef(db, uid), { attempts: d.attempts });
    return d;
  });
  if (!decision.ok) throw new HttpError(decision.status, decision.message);
}

export async function clearCode(db: Firestore, uid: string): Promise<void> {
  await codeRef(db, uid).delete().catch(() => {});
}

async function sendCodeEmail(to: string, code: string): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!key || !from) throw new HttpError(503, "Email codes are not set up on this installation.");
  const text = `Your cumulusOS verification code is ${code}.\n\nIt expires in 10 minutes. If you didn't create a cumulusOS account, you can ignore this email.`;
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#303030;line-height:1.5"><p>Your cumulusOS verification code is</p><p style="font-size:28px;font-weight:600;letter-spacing:6px;margin:12px 0">${code}</p><p style="color:#616161">It expires in 10 minutes. If you didn't create a cumulusOS account, you can ignore this email.</p></div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: `${code} is your cumulusOS code`, text, html }),
  });
  if (!res.ok) {
    console.error("[email-code] Resend refused the message", res.status, (await res.text().catch(() => "")).slice(0, 300));
    throw new HttpError(502, "The code email could not be sent. Try again in a minute.");
  }
}

/** Sets emailVerified on the Firebase account through the Identity Toolkit API (firebase-admin/auth cannot load on Vercel). */
export async function markEmailVerified(sa: ServiceAccount, uid: string): Promise<void> {
  const credential = adminApp(sa).options.credential;
  if (!credential) throw new HttpError(503, "The server has no Firebase credential.");
  const { access_token } = await credential.getAccessToken();
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/accounts:update`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ localId: uid, emailVerified: true }),
  });
  if (!res.ok) {
    console.error("[email-code] accounts:update failed", res.status, (await res.text().catch(() => "")).slice(0, 300));
    throw new HttpError(502, "Your code was right, but the account could not be updated. Try the code again.");
  }
}
