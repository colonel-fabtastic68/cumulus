import { createHmac, randomInt, timingSafeEqual } from "node:crypto";

/**
 * The rules for one-time sign-up codes, kept free of Firebase so they can be
 * tested on their own. A code lives for ten minutes, can be tried five times,
 * and a new one can be sent once a minute and five times an hour.
 */
export const CODE_TTL_MS = 10 * 60_000;
export const RESEND_COOLDOWN_MS = 60_000;
export const MAX_SENDS_PER_HOUR = 5;
export const MAX_ATTEMPTS = 5;
const HOUR_MS = 60 * 60_000;

export interface EmailCodeState {
  /** HMAC of `${uid}:${code}`; the code itself is never stored. */
  hash: string;
  email: string;
  expiresAt: number;
  attempts: number;
  sentAt: number;
  /** Send times inside the last hour, oldest first. */
  sends: number[];
}

export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashCode(code: string, uid: string, pepper: string): string {
  return createHmac("sha256", pepper).update(`${uid}:${code}`).digest("hex");
}

export type SendDecision = { ok: true; sends: number[] } | { ok: false; retryAfterMs: number; reason: "cooldown" | "hourly" };

export function decideSend(state: EmailCodeState | null, now: number): SendDecision {
  const sends = (state?.sends ?? []).filter((t) => now - t < HOUR_MS);
  if (state && now - state.sentAt < RESEND_COOLDOWN_MS) return { ok: false, retryAfterMs: RESEND_COOLDOWN_MS - (now - state.sentAt), reason: "cooldown" };
  if (sends.length >= MAX_SENDS_PER_HOUR) return { ok: false, retryAfterMs: HOUR_MS - (now - sends[0]!), reason: "hourly" };
  return { ok: true, sends: [...sends, now] };
}

export type VerifyDecision = { ok: true } | { ok: false; status: number; message: string; attempts?: number };

export function decideVerify(state: EmailCodeState | null, code: string, uid: string, pepper: string, now: number): VerifyDecision {
  if (!/^\d{6}$/.test(code)) return { ok: false, status: 400, message: "Enter the 6-digit code from the email." };
  if (!state) return { ok: false, status: 400, message: "There's no code waiting for this account. Send a new one." };
  if (now > state.expiresAt) return { ok: false, status: 400, message: "That code has expired. Send a new one." };
  if (state.attempts >= MAX_ATTEMPTS) return { ok: false, status: 429, message: "Too many wrong tries. Send a new code." };
  const expected = Buffer.from(state.hash, "hex");
  const given = Buffer.from(hashCode(code, uid, pepper), "hex");
  if (expected.length === given.length && timingSafeEqual(expected, given)) return { ok: true };
  const attempts = state.attempts + 1;
  const left = MAX_ATTEMPTS - attempts;
  return { ok: false, status: 400, attempts, message: left > 0 ? `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code isn't right. Send a new code to try again." };
}
