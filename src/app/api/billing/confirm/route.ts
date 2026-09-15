import { HttpError, authenticateAccount, jsonError, readJson } from "@/lib/integrations/server";
import { retrieveCheckoutSession, retrieveSubscription, saveSubscription, stripeConfig } from "@/lib/server/stripe";

/** Called when Stripe sends the account back: records the paid subscription so a workspace can be created. */
export async function POST(req: Request) {
  try {
    const ctx = await authenticateAccount(req);
    const cfg = stripeConfig();
    if (!cfg) throw new HttpError(503, "Payments are not switched on for this installation yet.");
    const { sessionId } = await readJson<{ sessionId?: unknown }>(req);
    if (typeof sessionId !== "string" || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new HttpError(400, "Unknown checkout session.");
    const session = await retrieveCheckoutSession(cfg, sessionId);
    if ((session.client_reference_id ?? session.metadata?.uid) !== ctx.uid) throw new HttpError(403, "That checkout belongs to another account.");
    if (session.status !== "complete") throw new HttpError(409, "Checkout isn't finished yet.");
    const sub = session.subscription && typeof session.subscription === "object" ? session.subscription : typeof session.subscription === "string" ? await retrieveSubscription(cfg, session.subscription) : null;
    if (!sub) throw new HttpError(409, "Stripe hasn't created the subscription yet. Try again in a moment.");
    const record = await saveSubscription(ctx.db, sub, { uid: ctx.uid, email: ctx.email || session.customer_details?.email || "" }, session.id);
    return Response.json({ status: record.status, workspaceId: record.workspaceId });
  } catch (e) {
    return jsonError(e);
  }
}
