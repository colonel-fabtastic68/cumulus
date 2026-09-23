import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { nowIso } from "@/lib/utils";

/**
 * The product-news mailing list: one document per address, keyed by a hash
 * so signups from the landing page and toggles on accounts land on the same
 * record. Server-only; the admin page reads and exports it.
 */

export interface MailingListEntry {
  email: string;
  subscribed: boolean;
  /** Where the address came from: the landing page, the demo gate, or an account toggle (then the uid). */
  source: "landing" | "demo" | "account";
  uid?: string;
  createdAt: string;
  updatedAt: string;
}

export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return /^[^\s@]{1,64}@[^\s@]{1,255}\.[a-z]{2,}$/.test(email) ? email : null;
}

export function mailingListId(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 32);
}

export async function setSubscription(db: Firestore, email: string, subscribed: boolean, source: MailingListEntry["source"], uid?: string): Promise<void> {
  const ref = db.doc(`mailingList/${mailingListId(email)}`);
  const now = nowIso();
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() as MailingListEntry) : null;
  await ref.set({ email, subscribed, source: existing?.source ?? source, ...(uid ? { uid } : existing?.uid ? { uid: existing.uid } : {}), createdAt: existing?.createdAt ?? now, updatedAt: now });
}

// Simple per-process rate limit for the public signup route (Vercel functions are short-lived, so this is a soft brake).
const hits = new Map<string, number[]>();
export function rateLimited(key: string, max = 5, windowMs = 60_000): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}
