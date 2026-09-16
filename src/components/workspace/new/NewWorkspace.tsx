"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Building2, Check, CreditCard, Lock, LogOut, Sparkles } from "lucide-react";
import { Badge, Banner, Button, CloudMark, Select, Skeleton, TextField, useToast } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { accountFetch } from "@/lib/account-fetch";
import { APP_HOME, signInHref } from "@/lib/auth-routes";
import { FOUNDING_PLAN, planSavingsPct } from "@/lib/billing";
import { formatMoney } from "@/lib/format";
import { useSession } from "@/lib/session";
import { describeWorkspaceError } from "@/lib/workspaces";
import { cn } from "@/lib/utils";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "MXN"];

interface BillingState {
  paymentsConfigured: boolean;
  exempt: boolean;
  exemptNeedsVerification: boolean;
  /** Paid subscriptions not attached to a workspace yet. */
  available: number;
}

const price = (n: number) => formatMoney(n, FOUNDING_PLAN.currency).replace(/\.00$/, "");

/**
 * Starting a workspace, on its own screen: subscribe first (Stripe Checkout),
 * then name the company. Accounts holding an unused subscription, or on the
 * exempt list, go straight to naming it.
 */
export function NewWorkspace() {
  const session = useSession();
  const { app, status, needsEmailCode } = session;
  const { signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const sessionId = params.get("session_id");
  const cancelled = params.get("checkout") === "cancelled";
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"checkout" | "create" | "sample" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(() => session.profile?.business?.name ?? "");
  const [currency, setCurrency] = useState("USD");
  const [nameError, setNameError] = useState<string | undefined>();
  const confirmed = useRef(false);

  const here = `${pathname}${params.toString() ? `?${params.toString()}` : ""}`;
  useEffect(() => {
    if (status === "signed-out") router.replace(signInHref(here));
    else if (needsEmailCode) router.replace(`/verify-email?next=${encodeURIComponent(here)}`);
  }, [status, needsEmailCode, here, router]);

  const ready = session.mode === "firestore" && !!app && (status === "ready" || status === "no-workspace") && !needsEmailCode;
  useEffect(() => {
    if (!ready || !app) return;
    let stale = false;
    (async () => {
      try {
        if (sessionId && !confirmed.current) {
          confirmed.current = true;
          await accountFetch(app, "/api/billing/confirm", { sessionId });
          window.history.replaceState(null, "", pathname);
        }
        const next = await accountFetch<BillingState>(app, "/api/billing/status");
        if (!stale) setBilling(next);
      } catch (e) {
        if (!stale) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      stale = true;
    };
  }, [ready, app, sessionId, pathname]);

  const subscribe = async () => {
    if (!app) return;
    setBusy("checkout");
    setError(null);
    try {
      const { url } = await accountFetch<{ url: string }>(app, "/api/billing/checkout", {});
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const create = async (e: FormEvent | undefined, sample: boolean) => {
    e?.preventDefault();
    if (!name.trim()) {
      setNameError("Give the company a name.");
      return;
    }
    setNameError(undefined);
    setBusy(sample ? "sample" : "create");
    setError(null);
    try {
      const membership = await session.createWorkspace({ name, currency, sample });
      toast(`${membership.name} is ready`, "success");
      router.replace(APP_HOME);
    } catch (err) {
      setError(describeWorkspaceError(err));
      setBusy(null);
    }
  };

  const plan = FOUNDING_PLAN;
  const canCreate = !!billing && (billing.exempt || billing.available > 0);
  let body: ReactNode;
  if (session.mode === "local") {
    body = (
      <Banner tone="info" title="Local mode has one workspace" action={<Button href={APP_HOME}>Open the workspace</Button>}>
        Accounts, subscriptions and more companies need Firestore mode.
      </Banner>
    );
  } else if (loadError) {
    body = (
      <Banner tone="critical" title="Couldn't load your plan" action={<Button onClick={() => window.location.reload()}>Try again</Button>}>
        {loadError}
      </Banner>
    );
  } else if (!billing) {
    body = (
      <section className="card flex flex-col gap-3 p-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-24 w-full" />
      </section>
    );
  } else if (canCreate) {
    body = (
      <section className="card p-6 md:p-8">
        {!billing.exempt && (
          <Banner tone="success" title="Subscription active" className="mb-5">
            Your {plan.name} subscription pays for the workspace you create now.
          </Banner>
        )}
        <h2 className="text-[16px] font-semibold text-text">Name your workspace</h2>
        <p className="mt-1 text-[13px] text-text-secondary">You become its owner and can invite the team from the Team page, free for every teammate.</p>
        <form onSubmit={(e) => void create(e, false)} noValidate className="mt-5 flex flex-col gap-4">
          <TextField label="Company name" value={name} onChange={(e) => setName(e.target.value)} error={nameError} placeholder="Halcyon Audio" autoComplete="organization" autoFocus />
          <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
          {error && <Banner tone="critical">{error}</Banner>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" size="lg" icon={<Building2 />} loading={busy === "create"} disabled={busy !== null}>
              Create workspace
            </Button>
            <Button type="button" size="lg" icon={<Sparkles />} loading={busy === "sample"} disabled={busy !== null} onClick={() => void create(undefined, true)}>
              Create with sample data
            </Button>
          </div>
          <p className="text-[12.5px] text-text-secondary">Sample data loads the Halcyon Audio demo: parts, BOMs, suppliers, orders and six months of history under your company name. Clear it later from Settings.</p>
        </form>
      </section>
    );
  } else {
    body = (
      <section className="card p-6 md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge tone="accent" size="large">
            {plan.name}
          </Badge>
          <Badge tone="success" size="large">
            {planSavingsPct(plan)}% off
          </Badge>
        </div>
        <div className="mt-5 flex flex-wrap items-end gap-x-3 gap-y-1">
          <span className="text-[44px] font-semibold leading-none tracking-[-0.03em] text-text">{price(plan.monthly)}</span>
          <span className="pb-1 text-[14px] text-text-secondary">per month</span>
          <span className="pb-1 text-[17px] text-text-tertiary line-through decoration-[1.5px]">{price(plan.listMonthly)}</span>
        </div>
        <p className="mt-3 text-[14px] font-medium text-text">{plan.blurb}</p>
        <ul className="mt-5 grid gap-2 sm:grid-cols-2">
          {plan.features.map((f) => (
            <li key={f} className="flex gap-2 text-[13px] leading-5 text-text-secondary">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              {f}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex flex-col gap-3">
          {cancelled && <Banner tone="info" title="Checkout was cancelled">Nothing was charged. Subscribe whenever you&apos;re ready.</Banner>}
          {!billing.paymentsConfigured && (
            <Banner tone="warning" title="Payments are not switched on yet">
              This installation can&apos;t take subscriptions yet, so new workspaces can&apos;t be created. Nothing was charged.
            </Banner>
          )}
          {billing.exemptNeedsVerification && (
            <Banner tone="info" title="Verify your email to skip payment">
              Your address may create workspaces without a subscription once it is verified. Sign out, then sign in with &quot;Email me a sign-in link&quot;.
            </Banner>
          )}
          {error && <Banner tone="critical">{error}</Banner>}
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button variant="primary" size="lg" icon={<CreditCard />} loading={busy === "checkout"} disabled={!billing.paymentsConfigured || busy !== null} onClick={() => void subscribe()}>
            Subscribe for {price(plan.monthly)}/month
          </Button>
          <p className="flex items-center gap-1.5 text-[12.5px] text-text-tertiary">
            <Lock className="h-3.5 w-3.5" /> Card details are entered on Stripe&apos;s secure page.
          </p>
        </div>
      </section>
    );
  }

  const step = canCreate ? 2 : 1;
  return (
    <div className="flex min-h-[100dvh] flex-col bg-bg">
      <header className="flex h-16 items-center gap-3 px-6">
        <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-primary text-text-inverse">
          <CloudMark />
        </span>
        <span className="text-[14px] font-semibold text-text">cumulusOS</span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="tertiary" icon={<ArrowLeft />} href="/account">
            Back to account
          </Button>
          {session.mode === "firestore" && (
            <Button size="sm" icon={<LogOut />} onClick={() => void signOut()}>
              Sign out
            </Button>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-[760px] px-4 pb-16 pt-4 sm:px-6 sm:pt-8">
        <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-text-tertiary">
          {["Subscribe", "Name your workspace"].map((label, i) => (
            <span key={label} className={cn("inline-flex items-center gap-1.5", step === i + 1 && "text-text")}>
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px]", step > i + 1 ? "bg-success text-white" : step === i + 1 ? "bg-primary text-text-inverse" : "bg-surface-hover")}>
                {step > i + 1 ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {label}
            </span>
          ))}
        </div>
        <h1 className="text-[24px] font-semibold leading-8 text-text">Start a new workspace</h1>
        <p className="mb-6 mt-1 text-[13.5px] text-text-secondary">Each workspace is a company with its own inventory and unlimited team users. Teammates you invite join free.</p>
        {body}
      </main>
    </div>
  );
}
