"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { UserRound } from "lucide-react";
import { Banner, Button, TextField } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { signUpHref } from "@/lib/auth-routes";
import { AuthPage, useNextPath } from "./AuthPage";
import { PasswordField, emailError } from "./fields";

export function SignInForm() {
  const { signIn, signInAsGuest, authError } = useAuth();
  const next = useNextPath();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState<"form" | "guest" | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = { email: emailError(email), password: password ? undefined : "Enter your password." };
    setErrors(next);
    if (next.email || next.password) return;
    setBusy("form");
    try {
      await signIn(email, password);
    } finally {
      setBusy(null);
    }
  };

  const guest = async () => {
    setBusy("guest");
    try {
      await signInAsGuest();
    } finally {
      setBusy(null);
    }
  };

  return (
    <AuthPage
      title="Sign in to Cumulus"
      subtitle="Your team's inventory workspace, live in Firestore."
      footer={
        <>
          New to Cumulus?{" "}
          <Link href={signUpHref(next)} className="font-medium text-accent hover:underline">
            Create your account
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} placeholder="you@company.com" autoComplete="email" autoFocus />
        <div>
          <PasswordField value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} autoComplete="current-password" />
          <div className="mt-1.5 text-right">
            <Link href={email.trim() ? `/reset-password?email=${encodeURIComponent(email.trim())}` : "/reset-password"} className="text-[12.5px] text-accent hover:underline">
              Forgot your password?
            </Link>
          </div>
        </div>
        {authError && <Banner tone="critical">{authError}</Banner>}
        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy === "form"} disabled={busy !== null}>
          Sign in
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-[11.5px] uppercase tracking-wide text-text-tertiary">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button size="lg" fullWidth icon={<UserRound />} onClick={guest} loading={busy === "guest"} disabled={busy !== null}>
        Continue as guest
      </Button>
      <p className="mt-2 text-center text-[12px] leading-4 text-text-tertiary">Guests get a temporary account on this browser. Create an account to keep your access across devices.</p>
    </AuthPage>
  );
}
