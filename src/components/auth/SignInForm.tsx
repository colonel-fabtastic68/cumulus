"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MailCheck, Send, UserRound } from "lucide-react";
import { Banner, Button, TextField } from "@/components/ui";
import { describeAuthError, useAuth } from "@/lib/auth";
import { EMAIL_FOR_SIGN_IN_KEY, finishMagicLink, isMagicLink, scrubMagicLink, sendMagicLink } from "@/lib/auth-link";
import { signInHref, signUpHref } from "@/lib/auth-routes";
import { useSession } from "@/lib/session";
import { AuthPage, useNextPath } from "./AuthPage";
import { PasswordField, emailError } from "./fields";

export function SignInForm() {
  const { signIn, signInAsGuest, authError } = useAuth();
  const { app, status } = useSession();
  const next = useNextPath();
  const params = useSearchParams();
  const [email, setEmail] = useState(() => params.get("email") ?? "");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [busy, setBusy] = useState<"form" | "guest" | "link" | "finish" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  /** An emailed link is in the address bar but this device does not know the address it was for. */
  const [needsEmail, setNeedsEmail] = useState(false);
  const linkTried = useRef(false);

  const finishLink = async (address: string) => {
    if (!app) return;
    setBusy("finish");
    setLinkError(null);
    try {
      await finishMagicLink(app, address, window.location.href);
      scrubMagicLink();
      try {
        localStorage.removeItem(EMAIL_FOR_SIGN_IN_KEY);
      } catch {}
    } catch (e) {
      setLinkError(describeAuthError(e));
      setNeedsEmail(true);
    } finally {
      setBusy(null);
    }
  };

  // Arriving on an emailed sign-in link: finish it with the address it was sent to.
  useEffect(() => {
    if (!app || status !== "signed-out" || linkTried.current) return;
    void (async () => {
      if (!(await isMagicLink(app, window.location.href))) return;
      linkTried.current = true;
      let saved = "";
      try {
        saved = localStorage.getItem(EMAIL_FOR_SIGN_IN_KEY) ?? "";
      } catch {}
      const address = saved || params.get("email") || "";
      if (address) {
        setEmail(address);
        void finishLink(address);
      } else setNeedsEmail(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, status]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (needsEmail) {
      const err = emailError(email);
      setErrors({ email: err });
      if (!err) void finishLink(email);
      return;
    }
    const nextErrors = { email: emailError(email), password: password ? undefined : "Enter your password." };
    setErrors(nextErrors);
    if (nextErrors.email || nextErrors.password) return;
    setBusy("form");
    try {
      await signIn(email, password);
    } finally {
      setBusy(null);
    }
  };

  const sendLink = async () => {
    const err = emailError(email);
    setErrors({ email: err });
    if (err || !app) return;
    setBusy("link");
    setLinkError(null);
    try {
      await sendMagicLink(app, email, `${signInHref(next)}${signInHref(next).includes("?") ? "&" : "?"}email=${encodeURIComponent(email.trim().toLowerCase())}`);
      try {
        localStorage.setItem(EMAIL_FOR_SIGN_IN_KEY, email.trim().toLowerCase());
      } catch {}
      setNotice(`A sign-in link is on its way to ${email.trim()}. Open it on this device or any other.`);
    } catch (e) {
      setLinkError(describeAuthError(e));
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
      title={needsEmail ? "Finish signing in" : "Sign in to Cumulus"}
      subtitle={needsEmail ? "Confirm the address this sign-in link was sent to." : "Your team's inventory workspace, live in Firestore."}
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
        {!needsEmail && (
          <div>
            <PasswordField value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} autoComplete="current-password" />
            <div className="mt-1.5 text-right">
              <Link href={email.trim() ? `/reset-password?email=${encodeURIComponent(email.trim())}` : "/reset-password"} className="text-[12.5px] text-accent hover:underline">
                Forgot your password?
              </Link>
            </div>
          </div>
        )}
        {authError && <Banner tone="critical">{authError}</Banner>}
        {linkError && <Banner tone="critical">{linkError}</Banner>}
        {notice && (
          <div className="flex items-start gap-3 rounded-[var(--radius)] bg-success-soft p-3 text-[13px] leading-5 text-success">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{notice}</p>
          </div>
        )}
        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy === "form" || busy === "finish"} disabled={busy !== null}>
          {needsEmail ? "Continue" : "Sign in"}
        </Button>
        {!needsEmail && (
          <Button type="button" size="lg" fullWidth icon={<Send />} loading={busy === "link"} disabled={busy !== null} onClick={() => void sendLink()}>
            Email me a sign-in link
          </Button>
        )}
      </form>

      {!needsEmail && (
        <>
          <div className="my-5 flex items-center gap-3 text-[11.5px] uppercase tracking-wide text-text-tertiary">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button size="lg" fullWidth icon={<UserRound />} onClick={guest} loading={busy === "guest"} disabled={busy !== null}>
            Continue as guest
          </Button>
          <p className="mt-2 text-center text-[12px] leading-4 text-text-tertiary">Guests get a temporary account on this browser. Create an account to keep your access across devices.</p>
        </>
      )}
    </AuthPage>
  );
}
