import { NextResponse } from "next/server";
import { isPlanId, PLANS } from "@/lib/billing";

/**
 * Starts a Stripe Checkout session for a plan and answers with its URL.
 *
 * Needs STRIPE_SECRET_KEY and the plan's price id (STRIPE_PRICE_FOUNDING) in
 * the environment; until both are set it answers 503 so the checkout page can
 * say payments are not switched on yet. Stripe hosts the card form, so no card
 * data ever reaches this server. Recording the subscription on the workspace
 * (a Stripe webhook writing settings.billing) is the next step.
 */
export async function POST(req: Request) {
  let body: { plan?: unknown; email?: unknown; company?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Send a JSON body." }, { status: 400 });
  }

  const plan = isPlanId(body.plan) ? PLANS[body.plan] : null;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const company = typeof body.company === "string" ? body.company.trim().slice(0, 120) : "";
  if (!plan) return NextResponse.json({ error: "bad_request", message: "Unknown plan." }, { status: 400 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "bad_request", message: "Enter a valid email address." }, { status: 400 });

  const key = process.env.STRIPE_SECRET_KEY?.trim();
  const price = process.env[plan.stripePriceEnv]?.trim();
  if (!key || !price) {
    return NextResponse.json({ error: "not_configured", message: "Payments are not switched on for this installation yet. Nothing was charged." }, { status: 503 });
  }

  const base = publicOrigin(req);
  const form = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    customer_email: email,
    allow_promotion_codes: "true",
    success_url: `${base}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/checkout?cancelled=1`,
    "metadata[plan]": plan.id,
    "metadata[company]": company,
    "subscription_data[metadata][plan]": plan.id,
    "subscription_data[metadata][company]": company,
  });

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const data = (await res.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
  if (!res.ok || !data?.url) {
    console.error("[billing] Stripe checkout session failed", res.status, data?.error?.message);
    return NextResponse.json({ error: "stripe", message: "Stripe did not accept the request. Nothing was charged." }, { status: 502 });
  }
  return NextResponse.json({ url: data.url });
}

/** Where Stripe should send people back to: APP_URL when set, else this request's own origin. */
function publicOrigin(req: Request): string {
  const configured = process.env.APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
  return forwardedHost ? `${forwardedProto}://${forwardedHost}` : new URL(req.url).origin;
}
