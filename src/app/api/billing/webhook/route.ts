import { getFirestore } from "firebase-admin/firestore";
import { adminApp } from "@/lib/mcp/adminStore";
import { jsonError, requireServiceAccount } from "@/lib/integrations/server";
import { verifyStripeSignature } from "@/lib/server/billingRules";
import { retrieveSubscription, saveSubscription, stripeConfig, type StripeCheckoutSession, type StripeSubscription } from "@/lib/server/stripe";

/**
 * Stripe webhook (STRIPE_WEBHOOK_SECRET): keeps subscription records and each
 * workspace's billing status current after checkout, renewals and cancellations.
 */
export async function POST(req: Request) {
  const cfg = stripeConfig();
  if (!cfg?.webhookSecret) return Response.json({ error: "Stripe webhooks are not configured." }, { status: 503 });
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get("stripe-signature"), cfg.webhookSecret)) return Response.json({ error: "Invalid signature." }, { status: 400 });
  let event: { type?: string; data?: { object?: unknown } };
  try {
    event = JSON.parse(payload);
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  try {
    const db = getFirestore(adminApp(requireServiceAccount()));
    if (event.type === "checkout.session.completed") {
      const session = event.data?.object as StripeCheckoutSession;
      const uid = session.client_reference_id ?? session.metadata?.uid;
      const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (uid && subId) await saveSubscription(db, await retrieveSubscription(cfg, subId), { uid, email: session.customer_details?.email ?? session.customer_email ?? "" }, session.id);
    } else if (event.type?.startsWith("customer.subscription.")) {
      const sub = event.data?.object as StripeSubscription;
      const known = (await db.doc(`subscriptions/${sub.id}`).get()).exists;
      if (known || sub.metadata?.uid) await saveSubscription(db, sub, { uid: sub.metadata?.uid ?? "", email: "" });
    }
    return Response.json({ received: true });
  } catch (e) {
    return jsonError(e);
  }
}
