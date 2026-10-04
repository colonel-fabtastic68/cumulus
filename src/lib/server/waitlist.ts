import type { Firestore } from "firebase-admin/firestore";
import { nowIso } from "@/lib/utils";
import { mailingListId, normalizeEmail } from "./mailingList";

/**
 * The waitlist: people who want a workspace built around their business.
 * One document per address, so a second visit updates the first rather than
 * adding a duplicate. Server-only; the admin page reads and exports it.
 */

export const WAITLIST = "waitlist";

export interface WaitlistEntry {
  email: string;
  company?: string;
  /** What they need the system to handle, in their own words. */
  needs?: string;
  /** Where the request came from. */
  source: "landing" | "sign-in" | "demo";
  /** They also asked for product news, so the address is on the mailing list too. */
  news?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type WaitlistRequest = Omit<WaitlistEntry, "createdAt" | "updatedAt" | "news"> & { news: boolean };

const MAX_COMPANY = 120;
const MAX_NEEDS = 1000;

/** Free text, trimmed to a sane length with control characters dropped. */
function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim()
    .slice(0, max);
  return text || undefined;
}

/** The request body from the site, checked; null when the address is not usable. */
export function parseWaitlistBody(body: Record<string, unknown>): WaitlistRequest | null {
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : null;
  if (!email) return null;
  const source = body.source === "sign-in" || body.source === "demo" ? body.source : "landing";
  return { email, company: cleanText(body.company, MAX_COMPANY), needs: cleanText(body.needs, MAX_NEEDS), source, news: body.news === true };
}

/** Adds the address, or refreshes its record; blank fields never erase what an earlier visit said. */
export async function joinWaitlist(db: Firestore, entry: WaitlistRequest): Promise<{ created: boolean }> {
  const ref = db.doc(`${WAITLIST}/${mailingListId(entry.email)}`);
  const now = nowIso();
  const snap = await ref.get();
  const existing = snap.exists ? (snap.data() as WaitlistEntry) : null;
  const company = entry.company ?? existing?.company;
  const needs = entry.needs ?? existing?.needs;
  const doc: WaitlistEntry = {
    email: entry.email,
    ...(company ? { company } : {}),
    ...(needs ? { needs } : {}),
    source: existing?.source ?? entry.source,
    news: entry.news || existing?.news === true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await ref.set(doc);
  return { created: !existing };
}
