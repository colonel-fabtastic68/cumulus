"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { MailCheck } from "lucide-react";
import { Banner, Button, TextField } from "@/components/ui";
import { accountFetch } from "@/lib/account-fetch";
import { useSession } from "@/lib/session";
import type { TwoStepPurpose } from "@/lib/twoStep";

type SendResponse = { verified?: boolean; sent?: boolean; email?: string; retryAfterSeconds?: number };

/**
 * Emails a two-step code for `purpose` as soon as it mounts, then checks what
 * the person types (six digits submit on their own). On success the ID token
 * is refreshed so the new claims are in effect before `onDone` runs.
 */
export function TwoStepCodeForm({ purpose, submitLabel, onDone, extra }: { purpose: TwoStepPurpose; submitLabel: string; onDone: () => void; extra?: ReactNode }) {
  const { app, account, refreshAccount } = useSession();
  const email = account?.email ?? "";
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"sending" | "checking" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const sentOnce = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const send = useCallback(async () => {
    if (!app) return;
    setBusy("sending");
    setError(null);
    try {
      const res = await accountFetch<SendResponse>(app, "/api/auth/two-step/send", { purpose });
      if (res.verified) {
        await refreshAccount();
        onDone();
        return;
      }
      setNotice(res.sent ? `We sent a 6-digit code to ${res.email ?? email}.` : `A code is already on its way to ${res.email ?? email}. Check your inbox and spam folder.`);
      setCooldown(res.sent ? 60 : (res.retryAfterSeconds ?? 60));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [app, purpose, email, refreshAccount, onDone]);

  // The first code goes out when the form opens (once, even under StrictMode's double effects).
  useEffect(() => {
    const t = setTimeout(() => {
      if (sentOnce.current) return;
      sentOnce.current = true;
      void send();
    }, 0);
    return () => clearTimeout(t);
  }, [send]);

  const verify = async (digits: string) => {
    if (!app || busy) return;
    if (digits.length !== 6) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setBusy("checking");
    setError(null);
    try {
      await accountFetch(app, "/api/auth/two-step/verify", { purpose, code: digits });
      await refreshAccount();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const onCode = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 6);
    setCode(digits);
    if (digits.length === 6) void verify(digits);
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void verify(code);
      }}
    >
      <TextField label="Code from the email" value={code} onChange={(e) => onCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" autoFocus className="font-mono text-[16px] tracking-[0.3em]" />
      {notice && !error && (
        <div className="flex items-start gap-3 rounded-[var(--radius)] bg-success-soft p-3 text-[13px] leading-5 text-success">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{notice}</p>
        </div>
      )}
      {error && <Banner tone="critical">{error}</Banner>}
      <Button type="submit" variant="primary" size="lg" fullWidth loading={busy === "checking"} disabled={busy !== null}>
        {submitLabel}
      </Button>
      <Button type="button" size="lg" fullWidth loading={busy === "sending"} disabled={busy !== null || cooldown > 0} onClick={() => void send()}>
        {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
      </Button>
      {extra}
    </form>
  );
}
