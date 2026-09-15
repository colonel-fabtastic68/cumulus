import { authenticateAccount, jsonError } from "@/lib/integrations/server";
import { isBillingExempt, isUsableCredit } from "@/lib/server/billingRules";
import { stripeConfig, subscriptionsFor } from "@/lib/server/stripe";

/** What the new-workspace screen needs: can this account pay, is it exempt, and does it hold an unused subscription. */
export async function GET(req: Request) {
  try {
    const ctx = await authenticateAccount(req);
    const records = await subscriptionsFor(ctx.db, ctx.uid);
    const exemptList = process.env.BILLING_EXEMPT_EMAILS;
    return Response.json({
      paymentsConfigured: !!stripeConfig(),
      exempt: isBillingExempt(ctx.email, ctx.emailVerified, exemptList),
      exemptNeedsVerification: !ctx.emailVerified && isBillingExempt(ctx.email, true, exemptList),
      available: records.filter(isUsableCredit).length,
    });
  } catch (e) {
    return jsonError(e);
  }
}
