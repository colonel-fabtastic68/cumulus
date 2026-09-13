import type { PlanId } from "./types";

export interface Plan {
  id: PlanId;
  name: string;
  /** Price per month for this plan, in `currency`. */
  monthly: number;
  /** The list price the plan is discounted from. */
  listMonthly: number;
  currency: string;
  blurb: string;
  features: string[];
  /** Env var holding the Stripe price id (price_…) for this plan. */
  stripePriceEnv: string;
}

/**
 * The plans Cumulus sells. Prices are shown on the landing page, the checkout
 * page and the billing settings; Stripe holds the matching price objects.
 */
export const PLANS: Record<PlanId, Plan> = {
  founding: {
    id: "founding",
    name: "Founding Members",
    monthly: 199,
    listMonthly: 299,
    currency: "USD",
    blurb: "Unlimited team users. One price for the whole company.",
    features: [
      "Unlimited team users: owners, admins, members, viewers and floor guests",
      "Unlimited items, BOMs, locations and stock movements",
      "Nimbus, the agent that drafts bulk changes for your approval",
      "Two-way Shopify and WooCommerce sync",
      "Shippo and EasyPost rates, labels and tracking",
      "Imports, exports, reports and the activity log",
      "Every future version and feature, included",
      "Priority support from the people who build it",
    ],
    stripePriceEnv: "STRIPE_PRICE_FOUNDING",
  },
};

export const FOUNDING_PLAN = PLANS.founding;

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PLANS, value);
}

/** Whole-number percentage off the list price, e.g. 33 for 199 from 299. */
export function planSavingsPct(plan: Plan): number {
  return Math.round((1 - plan.monthly / plan.listMonthly) * 100);
}
