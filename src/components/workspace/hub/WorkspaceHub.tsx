"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, KeyRound, LogOut, Mail, Sparkles } from "lucide-react";
import { Avatar, Badge, Banner, Button, CloudMark, Select, TextField, Toggle, useToast } from "@/components/ui";
import { describeAuthError, useAuth } from "@/lib/auth";
import { setPassword } from "@/lib/auth-link";
import { APP_HOME } from "@/lib/auth-routes";
import { useSession } from "@/lib/session";
import { describeWorkspaceError } from "@/lib/workspaces";
import { roleLabel } from "@/components/workspace/team/teamUtils";
import { passwordError } from "@/components/auth/fields";
import { PasswordField } from "@/components/auth/fields";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "MXN"];

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
        <CreateWorkspaceCard busy={busy} setBusy={setBusy} setError={setError} />
      </div>
    </div>
  );

  if (!standalone) return body;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-bg">
      <header className="flex h-16 items-center gap-3 px-6">
        <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-primary text-text-inverse">
          <CloudMark />
        </span>
        <span className="text-[14px] font-semibold text-text">Cumulus</span>
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
  const { signOut } = useAuth();
  const toast = useToast();
  const [password, setPw] = useState("");
  const [pwError, setPwError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const profile = session.profile;

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

function CreateWorkspaceCard({ busy, setBusy, setError }: { busy: string | null; setBusy: (b: string | null) => void; setError: (e: string | null) => void }) {
  const session = useSession();
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [sample, setSample] = useState(false);
  const [nameError, setNameError] = useState<string | undefined>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setNameError("Give the company a name.");
      return;
    }
    setNameError(undefined);
    setBusy("create");
    setError(null);
    try {
      const membership = await session.createWorkspace({ name, currency, sample });
      toast(`${membership.name} is ready`, "success");
      router.replace(APP_HOME);
    } catch (err) {
      setError(describeWorkspaceError(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="create" className="card scroll-mt-4 p-5">
      <h2 className="text-[14px] font-semibold text-text">Create a workspace</h2>
      <p className="mt-1 text-[12.5px] text-text-secondary">You become its owner and can invite the team from the Team page.</p>
      <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-3">
        <TextField label="Company name" value={name} onChange={(e) => setName(e.target.value)} error={nameError} placeholder="Halcyon Audio" autoComplete="organization" />
        <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        <Toggle label="Start with sample data" help="Loads the Halcyon Audio demo with six months of history. Clear it later from Settings." checked={sample} onChange={setSample} size="sm" />
        <Button type="submit" variant="primary" icon={sample ? <Sparkles /> : <Building2 />} loading={busy === "create"} disabled={busy !== null && busy !== "create"}>
          Create workspace
        </Button>
      </form>
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
