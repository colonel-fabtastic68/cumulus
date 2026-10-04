import { getFirestore } from "firebase-admin/firestore";
import { HttpError, jsonError, readJson, requireServiceAccount } from "@/lib/integrations/server";
import { adminApp } from "@/lib/mcp/adminStore";
import { rateLimited, setSubscription } from "@/lib/server/mailingList";
import { joinWaitlist, parseWaitlistBody } from "@/lib/server/waitlist";

export const maxDuration = 30;

/**
 * Joins the waitlist from the site. Public, no account needed; one record per
 * address; the mailing list is joined too only when the person ticked that.
 */
export async function POST(req: Request) {
  try {
    let sa;
    try {
      sa = requireServiceAccount();
    } catch {
      throw new HttpError(503, "The waitlist is not switched on for this install yet.");
    }
    const db = getFirestore(adminApp(sa));
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
    if (rateLimited(`waitlist:${ip}`)) throw new HttpError(429, "Too many sign-ups from this connection; try again in a minute.");
    const body = await readJson<Record<string, unknown>>(req);
    const entry = parseWaitlistBody(body);
    if (!entry) throw new HttpError(400, "Enter a valid email address.");
    const { created } = await joinWaitlist(db, entry);
    // Product news is a separate list with its own consent; a failure there must not undo the waitlist entry.
    if (entry.news) await setSubscription(db, entry.email, true, "landing").catch((e) => console.error("[waitlist] mailing list:", e));
    return Response.json({ ok: true, created });
  } catch (e) {
    return jsonError(e);
  }
}
