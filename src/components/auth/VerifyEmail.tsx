"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { MailCheck } from "lucide-react";
import { Banner, Button, Skeleton, TextField } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { accountFetch } from "@/lib/account-fetch";
import { signInHref } from "@/lib/auth-routes";
import { useSession } from "@/lib/session";
import { useNextPath } from "./AuthPage";

type SendResponse = { verified?: boolean; sent?: boolean; email?: string; retryAfterSeconds?: number };

/**
 * New password accounts land here until they enter the one-time code emailed
 * to them. A code goes out when the page opens; a new one can be sent after a
 * minute. Accounts with nothing to verify are sent on to where they were going.
 */
export function VerifyEmail() {
  const session = useSession();
  const { status: sessionStatus, needsEmailCode, refreshAccount, app } = session;
  const { signOut } = useAuth();
  const router = useRouter();
  const next = useNextPath();
  const email = session.account?.email ?? "";
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"sending" | "checking" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const sentOnce = useRef(false);

  useEffect(() => {
    if (sessionStatus === "signed-out") router.replace(signInHref(`/verify-email?next=${encodeURIComponent(next)}`));
    else if (sessionStatus !== "loading" && !needsEmailCode) router.replace(next);
  }, [sessionStatus, needsEmailCode, next, router]);

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
      const res = await accountFetch<SendResponse>(app, "/api/auth/email-code/send", {});
      if (res.verified) {
        await refreshAccount();
        return;
      }
      setNotice(res.sent ? `We sent a 6-digit code to ${res.email ?? email}.` : `A code is already on its way to ${res.email ?? email}. Check your inbox and spam folder.`);
      setCooldown(res.sent ? 60 : (res.retryAfterSeconds ?? 60));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [app, email, refreshAccount]);

  // Send the first code when the page opens (once, even under StrictMode's double effects).
  useEffect(() => {
    if (!needsEmailCode) return;
    const t = setTimeout(() => {
      if (sentOnce.current) return;
      sentOnce.current = true;
      void send();
    }, 0);
    return () => clearTimeout(t);
  }, [needsEmailCode, send]);

  const verify = async (digits: string) => {
    if (!app || busy) return;
    if (digits.length !== 6) {
      setError("Enter the 6-digit code from the email.");
      return;
    }
    setBusy("checking");
    setError(null);
    try {
      await accountFetch(app, "/api/auth/email-code/verify", { code: digits });
      await refreshAccount();
      router.replace(next);
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

  if (sessionStatus === "loading" || sessionStatus === "signed-out" || !needsEmailCode) {
    return (
      <Card title="Checking your account">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      </Card>
    );
  }

  return (
    <Card title="Check your email" subtitle={<>Enter the 6-digit code we sent to <span className="font-medium text-text">{email}</span>. It expires in 10 minutes.</>}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void verify(code);
        }}
      >
        <TextField label="Verification code" value={code} onChange={(e) => onCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" autoFocus className="font-mono text-[16px] tracking-[0.3em]" />
        {notice && !error && (
          <div className="flex items-start gap-3 rounded-[var(--radius)] bg-success-soft p-3 text-[13px] leading-5 text-success">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{notice}</p>
          </div>
        )}
        {error && <Banner tone="critical">{error}</Banner>}
        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy === "checking"} disabled={busy !== null}>
          Verify email
        </Button>
        <Button type="button" size="lg" fullWidth loading={busy === "sending"} disabled={busy !== null || cooldown > 0} onClick={() => void send()}>
          {cooldown > 0 ? `Send a new code in ${cooldown}s` : "Send a new code"}
        </Button>
      </form>
      <p className="mt-5 text-center text-[12.5px] text-text-secondary">
        Wrong address?{" "}
        <button type="button" onClick={() => void signOut()} className="font-medium text-accent hover:underline">
          Sign out
        </button>{" "}
        and create the account again.
      </p>
    </Card>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-6 sm:p-8">
      <h1 className="text-[20px] font-semibold leading-7 text-text">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[13.5px] leading-5 text-text-secondary">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}
