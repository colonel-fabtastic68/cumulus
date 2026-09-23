import { getFirestore } from "firebase-admin/firestore";
import { HttpError, authenticateAccount, jsonError, readJson, requireServiceAccount } from "@/lib/integrations/server";
import { adminApp } from "@/lib/mcp/adminStore";
import { normalizeEmail, rateLimited, setSubscription } from "@/lib/server/mailingList";

export const maxDuration = 30;

/**
 * Joins the mailing list. Public from the landing page (email in the body);
 * signed-in accounts toggle their own address and the flag on their profile
 * is kept in step by the client.
 */
export async function POST(req: Request) {
  try {
    const sa = requireServiceAccount();
    const db = getFirestore(adminApp(sa));
    const body = await readJson<{ email?: unknown; subscribed?: unknown; source?: unknown }>(req);
    const auth = req.headers.get("authorization");
    if (auth) {
      const ctx = await authenticateAccount(req);
      if (!ctx.email) throw new HttpError(400, "This account has no email address.");
      const subscribed = body.subscribed !== false;
      await setSubscription(db, ctx.email, subscribed, "account", ctx.uid);
      await db.doc(`users/${ctx.uid}`).set({ marketingEmails: subscribed }, { merge: true });
      return Response.json({ ok: true, subscribed });
    }
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
    if (rateLimited(`signup:${ip}`)) throw new HttpError(429, "Too many sign-ups from this connection; try again in a minute.");
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : null;
    if (!email) throw new HttpError(400, "Enter a valid email address.");
    await setSubscription(db, email, true, body.source === "demo" ? "demo" : "landing");
    return Response.json({ ok: true, subscribed: true });
  } catch (e) {
    return jsonError(e);
  }
}
