"use client";

import { Check } from "lucide-react";
import type { BillingStatus, WorkspaceSettings } from "@/lib/types";
import { Badge, Button, DescriptionList, type BadgeTone } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { FOUNDING_PLAN, planSavingsPct } from "@/lib/billing";

const STATUS: Record<BillingStatus, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  trialing: { label: "Trial", tone: "info" },
  past_due: { label: "Payment due", tone: "warning" },
  canceled: { label: "Cancelled", tone: "default" },
};

/** The workspace's plan. Without a billing record the workspace is on free pilot access. */
export function BillingSection({ settings }: { settings: WorkspaceSettings }) {
  const plan = FOUNDING_PLAN;
  const billing = settings.billing;
  const status = billing ? STATUS[billing.status] : null;
  return (
    <div className="card flex flex-col gap-4 p-4">
      <DescriptionList
        rows={[
          {
            label: "Plan",
            value: (
              <span className="inline-flex items-center gap-2">
                {billing ? plan.name : "Pilot access"}
                {status ? <Badge tone={status.tone}>{status.label}</Badge> : <Badge tone="info">Free for now</Badge>}
              </span>
            ),
          },
          {
            label: "Founding price",
            value: (
              <span>
                {formatMoney(plan.monthly, plan.currency)} a month <span className="text-text-tertiary line-through">{formatMoney(plan.listMonthly, plan.currency)}</span>{" "}
                <span className="text-text-secondary">· {planSavingsPct(plan)}% off, unlimited team users</span>
              </span>
            ),
          },
          ...(billing?.currentPeriodEnd ? [{ label: billing.status === "canceled" ? "Access until" : "Renews", value: formatDate(billing.currentPeriodEnd) }] : []),
        ]}
      />
      <ul className="grid gap-1.5 text-[12.5px] text-text-secondary sm:grid-cols-2">
        {plan.features.map((f) => (
          <li key={f} className="flex gap-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            {f}
          </li>
        ))}
      </ul>
      {billing ? (
        <p className="text-[12.5px] text-text-tertiary">Invoices, receipts and card changes are handled through Stripe.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[12.5px] text-text-tertiary">This workspace is on pilot access. New workspaces start with a subscription.</p>
          <Button href="/#pricing">See the plan</Button>
        </div>
      )}
    </div>
  );
}
