import type { Metadata } from "next";
import { Badge } from "@/components/ui";
import { SessionCta } from "@/components/marketing/SessionCta";
import { runtimeConfigFromEnv } from "@/lib/firebase-config";
import { FOUNDING_PLAN } from "@/lib/billing";
import { formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Welcome, founding member · Cumulus" };

/** Stripe sends people here after a successful checkout (success_url). */
export default function CheckoutSuccessPage() {
  const plan = FOUNDING_PLAN;
  return (
    <section className="mx-auto w-full max-w-[720px] px-6 py-20 md:py-28">
      <Badge tone="success" size="large">
        {plan.name}
      </Badge>
      <h1 className="mt-4 text-[34px] font-semibold leading-[1.08] tracking-[-0.025em] text-text md:text-[44px]">Welcome aboard.</h1>
      <p className="mt-4 text-[16px] leading-7 text-text-secondary md:text-[17px]">
        Your {plan.name} subscription is set up at {formatMoney(plan.monthly, plan.currency)} a month, and Stripe is emailing the receipt. Next comes a workspace: create one for your company, or open the one you already have.
      </p>
      <div className="mt-8">
        <SessionCta runtimeConfig={runtimeConfigFromEnv()} placement="success" />
      </div>
      <p className="mt-8 text-[13px] text-text-tertiary">Your plan and invoices live under Settings → Plan and billing once you are in.</p>
    </section>
  );
}
