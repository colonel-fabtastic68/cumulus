"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { Button, Checkbox, TextArea, TextField } from "@/components/ui";

/**
 * The waitlist on the site: an address, the company, and what the system
 * should handle. Posts to the public waitlist route; no account needed.
 */
export function WaitlistForm({ source = "landing", compact }: { source?: "landing" | "sign-in" | "demo"; compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [needs, setNeeds] = useState("");
  const [news, setNews] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(address)) {
      setState("error");
      setError("Enter a valid email address.");
      return;
    }
    setState("busy");
    setError(null);
    try {
      const res = await fetch("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: address, company, needs, news, source }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not save that right now. Try again in a moment.");
      setState("done");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (state === "done") {
    return (
      <div className="rounded-[var(--radius)] bg-success-soft p-4 text-[14px] leading-6 text-success">
        <p className="font-medium">You are on the list.</p>
        <p>We will write to {email.trim()} when it is your turn, with a few questions about your stock before anything gets built.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <div className={compact ? "flex flex-col gap-3" : "grid gap-3 sm:grid-cols-2"}>
        <TextField label="Work email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" error={state === "error" && error === "Enter a valid email address." ? error : undefined} />
        <TextField label="Company" hint="(optional)" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Halcyon Audio" autoComplete="organization" maxLength={120} />
      </div>
      {!compact && <TextArea label="What should it handle?" hint="(optional)" value={needs} onChange={(e) => setNeeds(e.target.value)} placeholder="Parts and assemblies, two warehouses, a Shopify store and a Square register, orders shipped with UPS…" rows={3} maxLength={1000} />}
      <Checkbox label="Also send product news, one email a month at most" checked={news} onChange={setNews} />
      {state === "error" && error && error !== "Enter a valid email address." && <p className="text-[13px] text-critical">{error}</p>}
      <div>
        <Button type="submit" variant="primary" size="lg" iconRight={<ArrowRight />} loading={state === "busy"} disabled={!email.trim() || state === "busy"}>
          Join the waitlist
        </Button>
      </div>
      <p className="text-[12.5px] leading-5 text-text-tertiary">No card, no account. We use this only to get in touch about your workspace.</p>
    </form>
  );
}
