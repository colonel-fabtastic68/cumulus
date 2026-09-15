import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingStatus } from "@/lib/types";

/**
 * Billing rules with no Firebase or network code, so they can be tested alone:
 * Stripe webhook signatures, status mapping, and who may create a workspace.
 */

/** Stripe's scheme: HMAC-SHA256 of `${t}.${payload}` with the endpoint secret, sent as `t=…,v1=…`. */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  let t = "";
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2);
    if (k?.trim() === "t") t = v?.trim() ?? "";
    else if (k?.trim() === "v1" && v) v1.push(v.trim());
  }
  const ts = Number(t);
  if (!t || !Number.isFinite(ts) || v1.length === 0 || Math.abs(nowSec - ts) > toleranceSec) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${payload}`, "utf8").digest("hex"), "hex");
  return v1.some((sig) => {
    const got = Buffer.from(sig, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export function billingStatusFromStripe(status: string): BillingStatus {
  if (status === "active") return "active";
  if (status === "trialing") return "trialing";
  if (status === "canceled" || status === "incomplete_expired") return "canceled";
  return "past_due";
}

/** Newer Stripe API versions moved current_period_end from the subscription onto its items. */
export function periodEndIso(sub: { current_period_end?: number | null; items?: { data?: Array<{ current_period_end?: number | null }> } }): string | undefined {
  const secs = sub.current_period_end ?? sub.items?.data?.find((i) => i.current_period_end)?.current_period_end ?? undefined;
  return secs ? new Date(secs * 1000).toISOString() : undefined;
}

/** A paid subscription that has not been attached to a workspace yet. */
export function isUsableCredit(r: { workspaceId: string | null; status: string }): boolean {
  return r.workspaceId === null && (r.status === "active" || r.status === "trialing");
}

/** BILLING_EXEMPT_EMAILS: comma or space separated addresses that may create workspaces without paying. Only verified addresses count. */
export function isBillingExempt(email: string, emailVerified: boolean, raw: string | undefined): boolean {
  if (!emailVerified || !email) return false;
  const list = (raw ?? "").split(/[,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}
