import type { Firestore } from "firebase-admin/firestore";
import { HttpError } from "@/lib/integrations/server";
import { FOUNDING_PLAN } from "@/lib/billing";
import type { PlanId, WorkspaceBilling } from "@/lib/types";
import { billingStatusFromStripe, periodEndIso } from "./billingRules";

/**
 * Stripe over its REST API (no SDK): subscription checkout, confirmation, and
 * the `subscriptions/{id}` records that decide who may create a workspace. A
 * record with no workspaceId is a paid slot waiting for its workspace.
 */

export interface StripeConfig {
  secretKey: string;
  priceId: string;
  webhookSecret?: string;
}

export function stripeConfig(): StripeConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const priceId = process.env[FOUNDING_PLAN.stripePriceEnv]?.trim();
  if (!secretKey || !priceId) return null;
  return { secretKey, priceId, webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() || undefined };
}

export interface SubscriptionRecord {
  id: string;
  uid: string;
  email: string;
  plan: PlanId;
  /** Stripe's own status string. */
  status: string;
  customerId?: string;
  currentPeriodEnd?: string;
  checkoutSessionId?: string;
  workspaceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StripeSubscription {
  id: string;
  status: string;
  customer: string | { id: string };
  current_period_end?: number | null;
  items?: { data?: Array<{ current_period_end?: number | null }> };
  metadata?: Record<string, string>;
}

export interface StripeCheckoutSession {
  id: string;
  status?: string | null;
  payment_status?: string | null;
  client_reference_id?: string | null;
  customer_email?: string | null;
  customer_details?: { email?: string | null } | null;
  subscription?: string | StripeSubscription | null;
  metadata?: Record<string, string> | null;
}

async function stripeFetch<T>(cfg: StripeConfig, path: string, form?: URLSearchParams): Promise<T> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: form ? "POST" : "GET",
    headers: { Authorization: `Bearer ${cfg.secretKey}`, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form,
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!res.ok || !data) {
    console.error("[billing] Stripe refused", path.split("?")[0], res.status, data?.error?.message);
    throw new HttpError(502, "Stripe did not accept the request. Nothing was charged.");
  }
  return data;
}

export async function createCheckoutSession(cfg: StripeConfig, opts: { uid: string; email: string; origin: string }): Promise<string> {
  const form = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": cfg.priceId,
    "line_items[0][quantity]": "1",
    client_reference_id: opts.uid,
    allow_promotion_codes: "true",
    success_url: `${opts.origin}/workspaces/new?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${opts.origin}/workspaces/new?checkout=cancelled`,
    "metadata[uid]": opts.uid,
    "metadata[plan]": FOUNDING_PLAN.id,
    "subscription_data[metadata][uid]": opts.uid,
    "subscription_data[metadata][plan]": FOUNDING_PLAN.id,
  });
  if (opts.email) form.set("customer_email", opts.email);
  const session = await stripeFetch<{ url?: string }>(cfg, "checkout/sessions", form);
  if (!session.url) throw new HttpError(502, "Stripe did not return a checkout page.");
  return session.url;
}

export function retrieveCheckoutSession(cfg: StripeConfig, id: string): Promise<StripeCheckoutSession> {
  return stripeFetch<StripeCheckoutSession>(cfg, `checkout/sessions/${encodeURIComponent(id)}?expand[]=subscription`);
}

export function retrieveSubscription(cfg: StripeConfig, id: string): Promise<StripeSubscription> {
  return stripeFetch<StripeSubscription>(cfg, `subscriptions/${encodeURIComponent(id)}`);
}

const subRef = (db: Firestore, id: string) => db.doc(`subscriptions/${id}`);

/** Creates or refreshes the record for a subscription, keeping any workspace it is already attached to. */
export async function saveSubscription(db: Firestore, sub: StripeSubscription, owner: { uid: string; email: string }, checkoutSessionId?: string): Promise<SubscriptionRecord> {
  const now = new Date().toISOString();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(subRef(db, sub.id));
    const prev = snap.exists ? (snap.data() as SubscriptionRecord) : null;
    const record: SubscriptionRecord = {
      id: sub.id,
      uid: prev?.uid ?? owner.uid,
      email: prev?.email || owner.email,
      plan: FOUNDING_PLAN.id,
      status: sub.status,
      customerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
      currentPeriodEnd: periodEndIso(sub),
      checkoutSessionId: prev?.checkoutSessionId ?? checkoutSessionId,
      workspaceId: prev?.workspaceId ?? null,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    tx.set(subRef(db, sub.id), JSON.parse(JSON.stringify(record)));
    if (record.workspaceId) tx.set(db.doc(`workspaces/${record.workspaceId}/settings/default`), { billing: workspaceBilling(record) }, { merge: true });
    return record;
  });
}

export function workspaceBilling(record: SubscriptionRecord): WorkspaceBilling {
  return JSON.parse(
    JSON.stringify({ plan: record.plan, status: billingStatusFromStripe(record.status), customerId: record.customerId, subscriptionId: record.id, currentPeriodEnd: record.currentPeriodEnd, updatedAt: record.updatedAt }),
  ) as WorkspaceBilling;
}

export async function subscriptionsFor(db: Firestore, uid: string): Promise<SubscriptionRecord[]> {
  const snap = await db.collection("subscriptions").where("uid", "==", uid).get();
  return snap.docs.map((d) => d.data() as SubscriptionRecord);
}
