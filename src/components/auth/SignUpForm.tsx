"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Banner, Button, TextField } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { signInHref } from "@/lib/auth-routes";
import { AuthPage, useNextPath } from "./AuthPage";
import { PasswordField, emailError, passwordError } from "./fields";

export function SignUpForm() {
  const { signUp, authError } = useAuth();
  const next = useNextPath();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next = { name: name.trim() ? undefined : "Enter your name.", email: emailError(email), password: passwordError(password) };
    setErrors(next);
    if (next.name || next.email || next.password) return;
    setBusy(true);
    try {
      await signUp(name, email, password);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthPage
      title="Create your account"
      subtitle="The first account in a workspace becomes its owner. Everyone after that joins as a member."
      footer={
        <>
          Already have an account?{" "}
          <Link href={signInHref(next)} className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <TextField label="Your name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} placeholder="Maya Okafor" autoComplete="name" autoFocus />
        <TextField label="Work email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} placeholder="you@company.com" autoComplete="email" />
        <PasswordField value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} autoComplete="new-password" help={errors.password ? undefined : "At least 6 characters."} />
        {authError && <Banner tone="critical">{authError}</Banner>}
        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy} disabled={busy}>
          Create account
        </Button>
      </form>
    </AuthPage>
  );
}
