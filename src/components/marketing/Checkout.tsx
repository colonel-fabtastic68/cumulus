"use client";

import { useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, Lock } from "lucide-react";
import { Badge, Banner, Button, TextField, type BannerTone } from "@/components/ui";
import { FOUNDING_PLAN, planSavingsPct } from "@/lib/billing";
import { formatMoney } from "@/lib/format";

type Notice = { tone: BannerTone; title: string; body: string } | null;

/**
 * Step one of buying the Founding Members plan: who is signing up and a plain
 * summary of what they will pay. The card itself is entered on Stripe's hosted
 * checkout page, which /api/billing/checkout redirects to once Stripe is connected.
 */
export function Checkout() {
  const plan = FOUNDING_PLAN;
  const params = useSearchParams();
  const cancelled = params.get("cancelled") === "1";
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: plan.id, company: company.trim(), email: email.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (res.ok && data.url) {
        window.location.assign(data.url);
        return;
      }
      if (res.status === 503) setNotice({ tone: "info", title: "Payments are not switched on yet", body: data.message ?? "Nothing was charged. Founding pricing still applies when checkout opens." });
      else setNotice({ tone: "critical", title: "Could not start checkout", body: data.message ?? "Nothing was charged. Try again in a moment." });
    } catch {
      setNotice({ tone: "critical", title: "Could not reach the server", body: "Check your connection and try again. Nothing was charged." });
    } finally {
      setBusy(false);
    }
  };

  const discount = plan.listMonthly - plan.monthly;

  return (
    <section className="mx-auto w-full max-w-[1120px] px-6 py-14 md:py-20">
      <div className="max-w-[640px]">
        <Badge tone="accent" size="large">
          {plan.name}
        </Badge>
        <h1 className="mt-4 text-[34px] font-semibold leading-[1.08] tracking-[-0.025em] text-text md:text-[44px]">Become a founding member.</h1>
        <p className="mt-4 text-[16px] leading-7 text-text-secondary md:text-[17px]">
          {formatMoney(plan.monthly, plan.currency)} a month instead of {formatMoney(plan.listMonthly, plan.currency)}, for every user on your team, for as long as you stay subscribed.
        </p>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12">
        <form onSubmit={submit} className="flex flex-col gap-5 rounded-[var(--radius-lg)] bg-surface p-6 shadow-[var(--shadow-card)] md:p-8">
          <div>
            <h2 className="text-[17px] font-semibold text-text">Your details</h2>
            <p className="mt-1 text-[13.5px] text-text-secondary">The receipt goes to this address, and it becomes the owner of the workspace.</p>
          </div>
          {cancelled && !notice && (
            <Banner tone="info" title="Checkout was cancelled">
              Nothing was charged. Pick up where you left off whenever you like.
            </Banner>
          )}
          {notice && (
            <Banner tone={notice.tone} title={notice.title}>
              {notice.body}
            </Banner>
          )}
          <TextField label="Company" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Halcyon Audio" autoComplete="organization" required maxLength={120} />
          <TextField label="Work email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" required />
          <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-1.5 text-[12.5px] text-text-tertiary">
              <Lock className="h-3.5 w-3.5" /> Card details are entered on Stripe&apos;s secure page.
            </p>
            <Button type="submit" variant="primary" size="lg" loading={busy} iconRight={<ArrowRight />}>
              Continue to secure payment
            </Button>
          </div>
        </form>

        <aside className="flex flex-col gap-5 rounded-[var(--radius-lg)] bg-surface p-6 shadow-[var(--shadow-card)] md:p-8">
          <div>
            <h2 className="text-[17px] font-semibold text-text">Order summary</h2>
            <p className="mt-1 text-[13.5px] text-text-secondary">{plan.blurb}</p>
          </div>
          <dl className="flex flex-col gap-2 text-[14px]">
            <div className="flex justify-between gap-4">
              <dt className="text-text-secondary">cumulusOS, monthly</dt>
              <dd className="tabular text-text">{formatMoney(plan.listMonthly, plan.currency)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-secondary">Founding discount ({planSavingsPct(plan)}%)</dt>
              <dd className="tabular text-success">−{formatMoney(discount, plan.currency)}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-border pt-3 text-[15px] font-semibold text-text">
              <dt>Due today</dt>
              <dd className="tabular">{formatMoney(plan.monthly, plan.currency)}</dd>
            </div>
          </dl>
          <p className="text-[12.5px] text-text-tertiary">Then {formatMoney(plan.monthly, plan.currency)} every month, billed in {plan.currency}. Cancel any time.</p>
          <ul className="flex flex-col gap-2 border-t border-border pt-5">
            {plan.features.map((f) => (
              <li key={f} className="flex gap-2.5 text-[13px] leading-5 text-text-secondary">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                {f}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  );
}
