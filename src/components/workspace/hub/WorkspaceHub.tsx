"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Check, KeyRound, LogOut, Mail, Sparkles } from "lucide-react";
import { Badge, Banner, Button, CloudMark, Select, TextField, Toggle, useToast } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { APP_HOME } from "@/lib/auth-routes";
import { useSession } from "@/lib/session";
import { describeWorkspaceError } from "@/lib/workspaces";
import { roleLabel } from "@/components/workspace/team/teamUtils";

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "MXN"];

/**
 * Where an account lands with no workspace, and the Workspaces page inside the
 * app: create a company, redeem an invite, or open another workspace.
 */
export function WorkspaceHub({ standalone = false, notice }: { standalone?: boolean; notice?: string }) {
  const session = useSession();
  const { signOut } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const codeParam = params.get("code") ?? "";

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoTried = useRef(false);

  const profile = session.profile;
  const canJoin = !!profile && session.mode === "firestore";

  const join = async (code: string) => {
    if (!canJoin) return;
    setBusy(code);
    setError(null);
    try {
      const membership = await session.acceptInvite(code);
      toast(`Welcome to ${membership.name}`, "success");
      router.replace(APP_HOME);
    } catch (e) {
      setError(describeWorkspaceError(e));
    } finally {
      setBusy(null);
    }
  };

  // A link with ?code= redeems itself once the profile is ready.
  useEffect(() => {
    if (!codeParam || autoTried.current || !canJoin) return;
    autoTried.current = true;
    void join(codeParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeParam, canJoin]);

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
      {notice && (
        <Banner tone="warning" title="Workspace unavailable">
          {notice}
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
        <CreateWorkspaceCard busy={busy} setBusy={setBusy} setError={setError} />
        <InvitesCard busy={busy} onJoin={join} initialCode={codeParam} />
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
        <p className="mt-1 mb-6 text-[13.5px] text-text-secondary">{session.workspaces.length ? "Pick a workspace to open, or start another company." : "You're signed in but not in a workspace yet. Create your company's workspace, or join one you were invited to."}</p>
        {body}
      </main>
    </div>
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

function InvitesCard({ busy, onJoin, initialCode }: { busy: string | null; onJoin: (code: string) => Promise<void>; initialCode: string }) {
  const session = useSession();
  const [code, setCode] = useState(initialCode);
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
        <p className="mt-1 text-[12.5px] text-text-secondary">
          {email ? (
            <>
              No pending invites for <span className="font-medium text-text">{email}</span>. When an owner or admin invites that address, the workspace appears here.
            </>
          ) : (
            "Guest sessions have no email to invite, so join with an invite code from a teammate, or create an account with your email."
          )}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onJoin(code);
        }}
        className="mt-4 flex flex-col gap-2"
      >
        <TextField label="Have an invite code or link?" value={code} onChange={(e) => setCode(e.target.value.trim().replace(/^.*[?&]code=/, ""))} placeholder="inv_…" autoComplete="off" />
        <Button type="submit" icon={<KeyRound />} loading={busy === code && code !== ""} disabled={!code.trim() || (busy !== null && busy !== code)} className="self-start">
          Join with code
        </Button>
      </form>
    </section>
  );
}
