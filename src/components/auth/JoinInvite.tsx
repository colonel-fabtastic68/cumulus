"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, LogOut, MailCheck, Send } from "lucide-react";
import type { WorkspaceInvite } from "@/lib/types";
import { Banner, Button, Skeleton } from "@/components/ui";
import { describeAuthError, useAuth } from "@/lib/auth";
import { finishMagicLink, isMagicLink, scrubMagicLink } from "@/lib/auth-link";
import { APP_HOME, signInHref, signUpHref } from "@/lib/auth-routes";
import { useSession } from "@/lib/session";
import { describeWorkspaceError, getInvite, joinPath, sendInviteEmail } from "@/lib/workspaces";
import { roleLabel } from "@/components/workspace/team/teamUtils";

type Phase = "idle" | "signing-in" | "joining" | "sent";

/**
 * The page an emailed invite opens. The link signs the invitee in (creating the
 * account when the address is new) and the workspace is joined right after.
 * Opened without the link token, it offers to email one, or to sign in another way.
 */
export function JoinInvite({ id }: { id: string }) {
  const session = useSession();
  const { signOut } = useAuth();
  const router = useRouter();
  const app = session.app;
  const [invite, setInvite] = useState<WorkspaceInvite | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const linkTried = useRef(false);
  const joinTried = useRef(false);

  useEffect(() => {
    if (!app) return;
    let cancelled = false;
    getInvite(app, id).then(
      (inv) => {
        if (!cancelled) setInvite(inv);
      },
      (e: unknown) => {
        if (cancelled) return;
        setLoadError(describeWorkspaceError(e));
        setInvite(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [app, id]);

  const pending = invite?.status === "pending" ? invite : null;
  const email = session.profile?.email ?? session.account?.email ?? "";
  const matches = !!pending && !!email && email === pending.email;

  const completeLink = async (inv: WorkspaceInvite) => {
    if (!app) return;
    setPhase("signing-in");
    setError(null);
    try {
      await finishMagicLink(app, inv.email!, window.location.href);
      scrubMagicLink();
    } catch (e) {
      setError(describeAuthError(e));
      setPhase("idle");
    }
  };

  const join = async (inv: WorkspaceInvite) => {
    setPhase("joining");
    setError(null);
    try {
      if (session.profile?.workspaces[inv.workspaceId]) session.switchWorkspace(inv.workspaceId);
      else await session.acceptInvite(inv.id);
      router.replace(APP_HOME);
    } catch (e) {
      setError(describeWorkspaceError(e));
      setPhase("idle");
    }
  };

  const resend = async () => {
    if (!app || !pending) return;
    setError(null);
    try {
      await sendInviteEmail(app, pending);
      setPhase("sent");
    } catch (e) {
      setError(describeAuthError(e));
    }
  };

  // Signed out and holding the emailed link: finish the sign-in.
  useEffect(() => {
    if (!app || !pending || session.status !== "signed-out" || linkTried.current) return;
    void (async () => {
      if (!(await isMagicLink(app, window.location.href))) return;
      linkTried.current = true;
      void completeLink(pending);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, pending, session.status]);

  // Signed in as the invited address: join.
  useEffect(() => {
    if (!pending || !session.profile || !matches || joinTried.current) return;
    joinTried.current = true;
    void join(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, session.profile, matches]);

  if (invite === undefined || session.status === "loading" || phase === "signing-in" || phase === "joining") {
    return (
      <Card title={phase === "joining" ? `Joining ${pending?.workspaceName ?? "the workspace"}` : phase === "signing-in" ? "Signing you in" : "Checking your invite"}>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
        {error && <Banner tone="critical" className="mt-4">{error}</Banner>}
      </Card>
    );
  }

  if (invite === null) {
    return loadError ? (
      <Card title="Couldn't load this invite" subtitle={loadError}>
        <Button variant="primary" href={signInHref(joinPath(id))}>
          Sign in and try again
        </Button>
      </Card>
    ) : (
      <Card title="This invite link isn't valid" subtitle="It may have been mistyped or removed. Ask the person who invited you for a new one.">
        <Button href="/sign-in">Go to sign in</Button>
      </Card>
    );
  }

  if (!pending) {
    return (
      <Card
        title={invite.status === "accepted" ? "This invite has already been used" : "This invite was revoked"}
        subtitle={invite.status === "accepted" ? `If that was you, sign in to open ${invite.workspaceName}.` : `Ask ${invite.invitedByName} to send a new one.`}
      >
        <Button variant="primary" href={session.status === "signed-out" ? signInHref(APP_HOME) : APP_HOME}>
          {session.status === "signed-out" ? "Sign in" : "Open Cumulus"}
        </Button>
      </Card>
    );
  }

  const header = (
    <div className="flex items-start gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-primary text-text-inverse">
        <Building2 className="h-5 w-5" />
      </span>
      <div>
        <div className="text-[15px] font-semibold text-text">{pending.workspaceName}</div>
        <div className="text-[13px] text-text-secondary">
          {pending.invitedByName} invited <span className="font-medium text-text">{pending.email}</span> as {roleLabel(pending.role).toLowerCase()}.
        </div>
      </div>
    </div>
  );

  if (session.status !== "signed-out" && !matches) {
    return (
      <Card title="This invite is for someone else">
        {header}
        <p className="mt-4 text-[13px] text-text-secondary">
          You&apos;re signed in as <span className="font-medium text-text">{email || "a guest"}</span>. Sign out to continue as {pending.email}.
        </p>
        {error && <Banner tone="critical" className="mt-3">{error}</Banner>}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" icon={<LogOut />} onClick={() => void signOut()}>
            Sign out and continue
          </Button>
          <Button href={APP_HOME}>Back to my workspace</Button>
        </div>
      </Card>
    );
  }

  if (phase === "sent") {
    return (
      <Card title="Check your inbox">
        <div className="flex items-start gap-3 rounded-[var(--radius)] bg-success-soft p-3 text-[13px] leading-5 text-success">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            A sign-in link is on its way to <span className="font-medium">{pending.email}</span>. Opening it signs you in and takes you into {pending.workspaceName}.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card title="You're invited">
      {header}
      {error && <Banner tone="critical" className="mt-4">{error}</Banner>}
      <div className="mt-5 flex flex-col gap-2">
        <Button variant="primary" size="lg" fullWidth icon={<Send />} onClick={() => void resend()}>
          Email me a sign-in link
        </Button>
        <Button size="lg" fullWidth href={`${signInHref(joinPath(id))}${signInHref(joinPath(id)).includes("?") ? "&" : "?"}email=${encodeURIComponent(pending.email!)}`}>
          Sign in with a password
        </Button>
      </div>
      <p className="mt-4 text-center text-[12.5px] text-text-secondary">
        New to Cumulus? The emailed link creates your account. Prefer a password?{" "}
        <Link href={`${signUpHref(joinPath(id))}${signUpHref(joinPath(id)).includes("?") ? "&" : "?"}email=${encodeURIComponent(pending.email!)}`} className="font-medium text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </Card>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="card p-6 sm:p-8">
      <h1 className="text-[20px] font-semibold leading-7 text-text">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[13.5px] leading-5 text-text-secondary">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}
