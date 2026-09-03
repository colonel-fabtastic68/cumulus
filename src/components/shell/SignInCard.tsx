"use client";

import { useState, type FormEvent } from "react";
import { UserRound } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Banner, Button, Segmented, TextField } from "@/components/ui";
import { CloudMark } from "./Sidebar";

type Mode = "signin" | "signup";

/** Firestore-mode sign-in: email + password (create or sign in) or a guest session. */
export function SignInCard() {
  const { signIn, signUp, signInAsGuest, resetPassword, authError } = useAuth();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"form" | "guest" | "reset" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setNotice(null);
    setBusy("form");
    try {
      if (mode === "signup") await signUp(name, email, password);
      else await signIn(email, password);
    } finally {
      setBusy(null);
    }
  };

  const guest = async () => {
    setNotice(null);
    setBusy("guest");
    try {
      await signInAsGuest();
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    if (!email.trim()) {
      setNotice("Enter your email above first, then click reset.");
      return;
    }
    setBusy("reset");
    try {
      if (await resetPassword(email)) setNotice(`Password reset email sent to ${email.trim()}.`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="text-center">
        <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[10px] bg-primary text-text-inverse">
          <CloudMark className="h-5 w-5" />
        </span>
        <h1 className="text-[16px] font-semibold">{mode === "signup" ? "Create your Cumulus account" : "Sign in to Cumulus"}</h1>
        <p className="mt-1 text-[13px] text-text-secondary">This workspace lives in Google Cloud Firestore. Everyone on the team sees the same data live.</p>
      </div>

      <Segmented
        className="mt-4 w-full [&>button]:flex-1"
        value={mode}
        onChange={(m) => {
          setMode(m);
          setNotice(null);
        }}
        options={[
          { value: "signin", label: "Sign in" },
          { value: "signup", label: "Create account" },
        ]}
      />

      <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
        {mode === "signup" && <TextField label="Your name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Baker Cobb" autoComplete="name" autoFocus />}
        <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" autoFocus={mode === "signin"} required />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          required
          minLength={6}
          help={mode === "signup" ? "At least 6 characters" : undefined}
        />
        {authError && <Banner tone="critical">{authError}</Banner>}
        {notice && <Banner tone="info">{notice}</Banner>}
        <Button type="submit" variant="primary" fullWidth loading={busy === "form"} disabled={busy !== null}>
          {mode === "signup" ? "Create account" : "Sign in"}
        </Button>
        {mode === "signin" && (
          <button type="button" onClick={reset} disabled={busy !== null} className="self-center text-[12.5px] text-accent hover:underline disabled:opacity-50">
            {busy === "reset" ? "Sending…" : "Forgot your password?"}
          </button>
        )}
      </form>

      <div className="my-4 flex items-center gap-3 text-[11.5px] uppercase tracking-wide text-text-tertiary">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button fullWidth icon={<UserRound />} onClick={guest} loading={busy === "guest"} disabled={busy !== null}>
        Continue as guest
      </Button>
      <p className="mt-2 text-center text-[12px] text-text-tertiary">Guests get a temporary account on this browser. Create an account to keep your access across devices.</p>
    </div>
  );
}
