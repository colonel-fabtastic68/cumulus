"use client";

import { useState, type FormEvent } from "react";
import { Mail } from "lucide-react";
import { Button, TextField } from "@/components/ui";

/** Landing-page signup for product news. Posts to the public mailing-list route; no account needed. */
export function MailingListForm({ compact }: { compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState("busy");
    setMessage(null);
    try {
      const res = await fetch("/api/mailing-list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not sign you up right now.");
      setState("done");
      setMessage("You're on the list. One email a month at most, and one click to leave.");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  if (state === "done") return <p className="text-[14px] text-success">{message}</p>;
  return (
    <form onSubmit={submit} noValidate className={compact ? "flex flex-col gap-2 sm:flex-row sm:items-end" : "flex flex-col gap-2 sm:flex-row sm:items-end"}>
      <TextField label={compact ? undefined : "Email"} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" containerClassName="flex-1 sm:min-w-[260px]" error={state === "error" ? (message ?? undefined) : undefined} />
      <Button type="submit" variant="primary" icon={<Mail />} loading={state === "busy"} disabled={!email.trim() || state === "busy"}>
        Get product news
      </Button>
    </form>
  );
}
