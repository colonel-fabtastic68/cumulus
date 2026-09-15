import { HttpError, appUrl, authenticateAccount, jsonError } from "@/lib/integrations/server";
import { createCheckoutSession, stripeConfig } from "@/lib/server/stripe";

/**
 * Starts Stripe Checkout for the Founding Members subscription, tied to the
 * signed-in account. Stripe hosts the card form; it returns to /workspaces/new.
 */
export async function POST(req: Request) {
  try {
    const ctx = await authenticateAccount(req);
    if (ctx.signInProvider === "anonymous" || !ctx.email) throw new HttpError(400, "Sign in with an email address to subscribe.");
    const cfg = stripeConfig();
    if (!cfg) throw new HttpError(503, "Payments are not switched on for this installation yet. Nothing was charged.");
    const url = await createCheckoutSession(cfg, { uid: ctx.uid, email: ctx.email, origin: appUrl(req) });
    return Response.json({ url });
  } catch (e) {
    return jsonError(e);
  }
}
