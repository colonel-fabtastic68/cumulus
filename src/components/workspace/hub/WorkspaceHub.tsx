"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, KeyRound, LogOut, Mail } from "lucide-react";
import { AppIcon, Avatar, Badge, Banner, Button, Toggle, useToast } from "@/components/ui";
import { accountFetch } from "@/lib/account-fetch";
import { FOUNDING_PLAN } from "@/lib/billing";
import { formatMoney } from "@/lib/format";
import { describeAuthError, useAuth } from "@/lib/auth";
import { setPassword } from "@/lib/auth-link";
import { APP_HOME } from "@/lib/auth-routes";
import { useSession } from "@/lib/session";
import { describeWorkspaceError } from "@/lib/workspaces";
import { roleLabel } from "@/components/workspace/team/teamUtils";
import { passwordError } from "@/components/auth/fields";
import { PasswordField } from "@/components/auth/fields";

/**
 * The Account page inside the app, and the page an account lands on with no
 * workspace: switch or open a workspace, create a company, join an invite.
 */
export function WorkspaceHub({ standalone = false, notice }: { standalone?: boolean; notice?: string }) {
  const session = useSession();
  const { signOut } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const profile = session.profile;
  const shownNotice = notice ?? session.notice ?? undefined;

  const join = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const membership = await session.acceptInvite(id);
      toast(`Welcome to ${membership.name}`, "success");
      router.replace(APP_HOME);
    } catch (e) {
      setError(describeWorkspaceError(e));
    } finally {
      setBusy(null);
    }
  };

  const open = (id: string) => {
    session.switchWorkspace(id);
    router.replace(APP_HOME);
  };

  if (session.mode === "local") {
    return (
      <Banner tone="info" title="Local mode has one workspace">
        Accounts, invites and multiple companies need Firestore mode. Everything here lives in this browser.
      </Banner>
    );
  }

  const body = (
    <div className="flex flex-col gap-4">
      {shownNotice && (
        <Banner tone="warning" title="Workspace unavailable" onDismiss={session.notice ? session.clearNotice : undefined}>
          {shownNotice}
        </Banner>
      )}
      {session.error && (
        <Banner tone="critical" title="Could not load your account">
          {session.error}
        </Banner>
      )}
      {error && (
        <Banner tone="critical" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}

      {!standalone && <AccountCard />}

      {session.workspaces.length > 0 && (
        <section className="card p-0">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-[13.5px] font-semibold text-text">Your workspaces</h2>
          </div>
          <ul>
            {session.workspaces.map((w) => (
              <li key={w.id} className="flex items-center gap-3 border-t border-border px-4 py-3 first:border-t-0">
                <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-primary text-text-inverse">
                  <Building2 className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-text">{w.name}</div>
                  <div className="text-[12px] text-text-secondary">{roleLabel(w.role)}</div>
                </div>
                {w.id === session.workspaceId && !standalone ? (
                  <Badge tone="success">Open</Badge>
                ) : (
                  <Button size="sm" onClick={() => open(w.id)}>
                    Open
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <InvitesCard busy={busy} onJoin={join} />
        <CreateWorkspaceCard />
      </div>
    </div>
  );

  if (!standalone) return body;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-bg">
      <header className="flex h-16 items-center gap-3 px-6">
        <AppIcon size={28} />
        <span className="text-[14px] font-semibold text-text">cumulusOS</span>
        <div className="ml-auto flex items-center gap-3 text-[12.5px] text-text-secondary">
          <span className="hidden sm:inline">
            Signed in as <span className="font-medium text-text">{profile?.name ?? "…"}</span>
            {profile?.email ? ` · ${profile.email}` : profile?.guest ? " · guest session" : ""}
          </span>
          <Button size="sm" icon={<LogOut />} onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[880px] px-4 pb-16 pt-4 sm:px-6 sm:pt-8">
        <h1 className="text-[22px] font-semibold leading-8 text-text">{session.workspaces.length ? "Your workspaces" : `Welcome, ${profile?.name?.split(" ")[0] ?? "there"}`}</h1>
        <p className="mt-1 mb-6 text-[13.5px] text-text-secondary">
          {session.workspaces.length ? "Pick a workspace to open, or start another company." : "You're signed in but not in a workspace yet. Join one you were invited to, or create your company's workspace."}
        </p>
        {body}
      </main>
    </div>
  );
}

function AccountCard() {
  const session = useSession();
  const { signOut, resetPassword } = useAuth();
  const toast = useToast();
  const [password, setPw] = useState("");
  const [pwError, setPwError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const profile = session.profile;
  const hasPassword = session.account?.passwordAccount === true;
  const [newsBusy, setNewsBusy] = useState(false);
  const toggleNews = async (on: boolean) => {
    if (!session.app) return;
    setNewsBusy(true);
    try {
      await accountFetch(session.app, "/api/mailing-list", { subscribed: on });
      toast(on ? "You'll get product news by email." : "Unsubscribed from product news.", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setNewsBusy(false);
    }
  };

  // Password accounts change theirs through the reset email: Firebase wants a sign-in from the last few minutes otherwise.
  const sendReset = async () => {
    const email = session.account?.email;
    if (!email) return;
    setSaving(true);
    try {
      if (await resetPassword(email)) {
        setResetSent(true);
        toast(`Password reset email sent to ${email}`, "success");
      }
    } finally {
      setSaving(false);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const err = passwordError(password);
    setPwError(err);
    if (err || !session.app) return;
    setSaving(true);
    try {
      await setPassword(session.app, password);
      setPw("");
      toast("Password set. You can sign in with it from now on.", "success");
    } catch (err2) {
      setPwError(describeAuthError(err2));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar member={{ name: profile?.name ?? "?", color: "#1f5f8b" }} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold text-text">{profile?.name ?? "…"}</div>
          <div className="truncate text-[12.5px] text-text-secondary">{profile?.email || (profile?.guest ? "Guest session on this browser" : "")}</div>
        </div>
        <Button size="sm" icon={<LogOut />} onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
      {!profile?.guest && (
        <div className="mt-5 border-t border-border pt-4">
          <Toggle label="Product news by email" help="What shipped, new integrations, pilot stories. At most one email a month." checked={profile?.marketingEmails === true} onChange={(v) => void toggleNews(v)} disabled={newsBusy} size="sm" />
        </div>
      )}
      {!profile?.guest && hasPassword && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="flex items-center gap-2 text-[13px] text-text-secondary">
            <KeyRound className="h-4 w-4 text-text-tertiary" />
            <span>
              <span className="font-medium text-text">Password</span> · set. You sign in with your email and password.
            </span>
          </div>
          <Button size="sm" onClick={() => void sendReset()} loading={saving} disabled={saving || resetSent}>
            {resetSent ? "Reset email sent" : "Change password"}
          </Button>
        </div>
      )}
      {!profile?.guest && !hasPassword && (
        <form onSubmit={save} noValidate className="mt-5 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end">
          <PasswordField
            label="Set a password"
            value={password}
            onChange={(e) => setPw(e.target.value)}
            error={pwError}
            autoComplete="new-password"
            help={pwError ? undefined : "Accounts that arrived from an emailed link have none yet. With one set, you can sign in without a link."}
            containerClassName="flex-1"
          />
          <Button type="submit" icon={<KeyRound />} loading={saving} disabled={saving} className="sm:mb-[22px]">
            Save password
          </Button>
        </form>
      )}
    </section>
  );
}

function CreateWorkspaceCard() {
  return (
    <section id="create" className="card scroll-mt-4 p-5">
      <h2 className="text-[14px] font-semibold text-text">Create a workspace</h2>
      <p className="mt-1 text-[12.5px] leading-5 text-text-secondary">
        Start a company with its own inventory. Each workspace is {formatMoney(FOUNDING_PLAN.monthly, FOUNDING_PLAN.currency).replace(/\.00$/, "")} a month on the {FOUNDING_PLAN.name} plan, with unlimited team users.
      </p>
      <Button variant="primary" icon={<Building2 />} href="/workspaces/new" className="mt-4">
        Create a workspace
      </Button>
    </section>
  );
}

function InvitesCard({ busy, onJoin }: { busy: string | null; onJoin: (id: string) => Promise<void> }) {
  const session = useSession();
  const email = session.profile?.email;
  const invites = session.pendingInvites;

  return (
    <section className="card p-5">
      <h2 className="text-[14px] font-semibold text-text">Invites</h2>
      {invites.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {invites.map((inv) => (
            <li key={inv.id} className="flex items-center gap-3 rounded-[var(--radius)] border border-border px-3 py-2.5">
              <Mail className="h-4 w-4 shrink-0 text-icon" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-text">{inv.workspaceName}</div>
                <div className="text-[12px] text-text-secondary">
                  {roleLabel(inv.role)} · invited by {inv.invitedByName}
                </div>
              </div>
              <Button size="sm" variant="primary" icon={<Check />} loading={busy === inv.id} disabled={busy !== null && busy !== inv.id} onClick={() => void onJoin(inv.id)}>
                Join
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-[12.5px] leading-5 text-text-secondary">
          {email ? (
            <>
              No pending invites for <span className="font-medium text-text">{email}</span>. When an owner or admin invites that address, the workspace appears here and a sign-in link lands in your inbox.
            </>
          ) : (
            "Guest sessions have no email address to invite. Create an account with your email to receive invites."
          )}
        </p>
      )}
    </section>
  );
}
