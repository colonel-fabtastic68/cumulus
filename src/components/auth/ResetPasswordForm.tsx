"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MailCheck } from "lucide-react";
import { Banner, Button, TextField } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { AuthPage } from "./AuthPage";
import { emailError } from "./fields";

export function ResetPasswordForm() {
  const { resetPassword, authError } = useAuth();
  const params = useSearchParams();
  const [email, setEmail] = useState(() => params.get("email") ?? "");
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err = emailError(email);
    setError(err);
    if (err) return;
    setBusy(true);
    try {
      if (await resetPassword(email)) setSentTo(email.trim());
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <Link href="/sign-in" className="font-medium text-accent hover:underline">
      Back to sign in
    </Link>
  );

  if (sentTo) {
    return (
      <AuthPage title="Check your inbox" footer={footer}>
        <div className="flex items-start gap-3 rounded-[var(--radius)] bg-success-soft p-3 text-[13px] leading-5 text-success">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            A reset link is on its way to <span className="font-medium">{sentTo}</span>. Follow it to choose a new password, then sign in again.
          </p>
        </div>
      </AuthPage>
    );
  }

  return (
    <AuthPage title="Reset your password" subtitle="Enter the email you signed up with and we will send a link to choose a new password." footer={footer}>
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error} placeholder="you@company.com" autoComplete="email" autoFocus />
        {authError && <Banner tone="critical">{authError}</Banner>}
        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy} disabled={busy}>
          Send reset link
        </Button>
      </form>
    </AuthPage>
  );
}
