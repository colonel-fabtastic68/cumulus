"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Banner, Button, Skeleton, TextField } from "@/components/ui";
import { INTEGRATIONS } from "@/components/workspace/integrations/catalog";
import { signInHref } from "@/lib/auth-routes";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { useNextPath } from "./AuthPage";

const INDUSTRIES = ["Electronics", "Machinery & equipment", "Food & beverage", "Consumer goods", "Automotive & aerospace", "Medical devices", "Construction & building products", "Wholesale & distribution", "Retail & e-commerce", "Other"];
const SIZES = ["Just me", "2–10", "11–50", "51–200", "200+"];

/**
 * Four questions, once, right after a new account confirms its email. Every
 * answer is optional and Skip counts as done, so nobody sees this twice.
 */
export function Intake() {
  const session = useSession();
  const { status, needsEmailCode, needsIntake, saveIntake, account } = session;
  const router = useRouter();
  const next = useNextPath();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [size, setSize] = useState("");
  const [integrations, setIntegrations] = useState<string[]>([]);
  const [busy, setBusy] = useState<"save" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === "signed-out") router.replace(signInHref(`/welcome?next=${encodeURIComponent(next)}`));
    else if (needsEmailCode) router.replace(`/verify-email?next=${encodeURIComponent(`/welcome?next=${encodeURIComponent(next)}`)}`);
    else if (status !== "loading" && !needsIntake) router.replace(next);
  }, [status, needsEmailCode, needsIntake, next, router]);

  const toggle = (id: string) =>
    setIntegrations((cur) => {
      if (id === "none") return cur.includes("none") ? [] : ["none"];
      const without = cur.filter((x) => x !== "none" && x !== id);
      return cur.includes(id) ? without : [...without, id];
    });

  const finish = async (skipped: boolean, e?: FormEvent) => {
    e?.preventDefault();
    setBusy(skipped ? "skip" : "save");
    setError(null);
    try {
      await saveIntake(skipped ? { name: "", industry: "", size: "", integrations: [], skipped: true } : { name: name.trim(), industry, size, integrations });
      router.replace(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
      setBusy(null);
    }
  };

  if (status === "loading" || status === "signed-out" || !needsIntake) {
    return (
      <section className="card p-6 sm:p-8">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      </section>
    );
  }

  const first = (account?.name ?? "").trim().split(/\s+/)[0];
  return (
    <section className="card p-6 sm:p-8">
      <h1 className="text-[20px] font-semibold leading-7 text-text">{first ? `Welcome, ${first}` : "Welcome"}</h1>
      <p className="mt-1.5 text-[13.5px] leading-5 text-text-secondary">Four quick questions so cumulusOS fits your business from day one. All optional.</p>
      <form noValidate onSubmit={(e) => void finish(false, e)} className="mt-5 flex flex-col gap-5">
        <TextField label="Business name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Halcyon Audio" autoComplete="organization" autoFocus />

        <Field label="Industry">
          <select value={industry} onChange={(e) => setIndustry(e.target.value)} className="h-9 w-full rounded-[var(--radius-sm)] border border-border bg-surface px-2.5 text-[13.5px] text-text focus:border-accent focus:outline-none">
            <option value="">Choose one</option>
            {INDUSTRIES.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Team size">
          <Chips options={SIZES.map((s) => ({ id: s, label: s }))} selected={size ? [size] : []} onToggle={(id) => setSize((cur) => (cur === id ? "" : id))} />
        </Field>

        <Field label="Which of these would you connect?">
          <Chips options={[...INTEGRATIONS.map((d) => ({ id: d.id, label: d.name.replace(/ Online$/, "") })), { id: "none", label: "None yet" }]} selected={integrations} onToggle={toggle} />
        </Field>

        {error && <Banner tone="critical">{error}</Banner>}
        <div className="flex flex-col gap-2">
          <Button type="submit" variant="primary" size="lg" fullWidth loading={busy === "save"} disabled={busy !== null}>
            Continue
          </Button>
          <Button type="button" variant="plain" size="lg" fullWidth loading={busy === "skip"} disabled={busy !== null} onClick={() => void finish(true)}>
            Skip for now
          </Button>
        </div>
      </form>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-text">{label}</span>
      {children}
    </div>
  );
}

function Chips({ options, selected, onToggle }: { options: Array<{ id: string; label: string }>; selected: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o.id);
        return (
          <button key={o.id} type="button" aria-pressed={on} onClick={() => onToggle(o.id)} className={cn("h-8 rounded-full border px-3 text-[12.5px] font-medium transition-colors", on ? "border-accent bg-accent-soft text-accent" : "border-border bg-surface text-text-secondary hover:bg-surface-hover hover:text-text")}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
