"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { Button, TextArea, TextField } from "@/components/ui";
import { CONTACT_EMAIL } from "@/lib/contact";

/**
 * The site's contact form. Posts to the public inquiry route, which files the
 * note and mails it to hello@. `kind` only changes the wording and the subject.
 */
export function InquiryForm({ kind = "general", submitLabel = "Send", stockLabel = "What do you stock?" }: { kind?: "general" | "demo"; submitLabel?: string; stockLabel?: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [industry, setIndustry] = useState("");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email.trim())) {
      setState("error");
      setError("Enter a valid email address.");
      return;
    }
    setState("busy");
    setError(null);
    try {
      const res = await fetch("/api/inquiry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, name, email: email.trim(), company, industry, message, page: window.location.pathname }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not send that right now. Try again in a moment.");
      setState("done");
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (state === "done") {
    return (
      <div className="rounded-[var(--radius)] bg-success-soft p-4 text-[14px] leading-6 text-success">
        <p className="font-medium">Thanks, {name.trim().split(" ")[0]}. It is on its way.</p>
        <p>We read every note ourselves and reply from {CONTACT_EMAIL}, usually the same business day.</p>
      </div>
    );
  }

  const emailError = state === "error" && error === "Enter a valid email address." ? error : undefined;
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam Rivera" autoComplete="name" maxLength={120} />
        <TextField label="Work email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" error={emailError} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Company" hint="(optional)" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Rivera Fabrication" autoComplete="organization" maxLength={120} />
        <TextField label={stockLabel} hint="(optional)" value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Welding consumables, two warehouses" maxLength={160} />
      </div>
      <TextArea label="What is not working today?" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Where stock lives now, what breaks, and what you would want fixed first…" rows={4} maxLength={4000} />
      {state === "error" && error && !emailError && <p className="text-[13px] text-critical">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" size="lg" iconRight={<ArrowRight />} loading={state === "busy"} disabled={!name.trim() || !email.trim() || message.trim().length < 10 || state === "busy"}>
          {submitLabel}
        </Button>
        <span className="text-[12.5px] text-text-tertiary">
          Or write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-text hover:text-accent">
            {CONTACT_EMAIL}
          </a>
        </span>
      </div>
    </form>
  );
}
