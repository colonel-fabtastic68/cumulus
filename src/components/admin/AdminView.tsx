"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { Badge, Banner, Button, CloudMark, DescriptionList, Skeleton, Stat, Table, type Column } from "@/components/ui";
import { accountFetch } from "@/lib/account-fetch";
import { APP_HOME, signInHref } from "@/lib/auth-routes";
import { formatDate, formatRelative } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { AdminAccount, AdminFeedback, AdminOverview, AdminSubscription, AdminWorkspace } from "@/lib/server/admin";

/** Founder's read-only view of every account, workspace and subscription (ADMIN_EMAILS on the server decides who may open it). */
export function AdminView() {
  const session = useSession();
  const { app, status, needsEmailCode } = session;
  const router = useRouter();
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (status === "signed-out") router.replace(signInHref("/admin"));
    else if (needsEmailCode) router.replace(`/verify-email?next=${encodeURIComponent("/admin")}`);
  }, [status, needsEmailCode, router]);

  const ready = session.mode === "firestore" && !!app && (status === "ready" || status === "no-workspace") && !needsEmailCode;

  const load = async () => {
    if (!app) return;
    setLoading(true);
    setError(null);
    try {
      setData(await accountFetch<AdminOverview>(app, "/api/admin/overview", undefined, { method: "GET" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const selected = useMemo(() => data?.workspaces.find((w) => w.id === open) ?? null, [data, open]);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-bg">
      <header className="flex h-16 items-center gap-3 px-6">
        <Link href="/" className="flex items-center gap-2 rounded-[var(--radius-sm)] text-[14px] font-semibold text-text">
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-primary text-text-inverse">
            <CloudMark />
          </span>
          cumulusOS
        </Link>
        <Badge tone="info">Admin</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" icon={<RefreshCw />} onClick={() => void load()} loading={loading} disabled={!ready}>
            Refresh
          </Button>
          <Button size="sm" variant="plain" href={APP_HOME}>
            Back to the app
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-2 sm:px-6">
        {session.mode === "local" ? (
          <Banner tone="info" title="Local mode has no accounts">Sign in to the hosted version to see accounts and workspaces.</Banner>
        ) : error ? (
          <Banner tone={error.includes("administrators") ? "info" : "critical"} title={error.includes("administrators") ? "Not an admin account" : "Couldn't load the overview"} action={<Button onClick={() => void load()}>Try again</Button>}>
            {error}
          </Banner>
        ) : !data ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : (
          <Overview data={data} open={open} onOpen={(id) => setOpen((cur) => (cur === id ? null : id))} selected={selected} />
        )}
      </main>
    </div>
  );
}

function Overview({ data, open, onOpen, selected }: { data: AdminOverview; open: string | null; onOpen: (id: string) => void; selected: AdminWorkspace | null }) {
  const paying = data.subscriptions.filter((s) => s.status === "active" || s.status === "trialing").length;
  const seenThisWeek = new Set(data.workspaces.flatMap((w) => w.members.filter((m) => m.lastSeenAt && Date.now() - Date.parse(m.lastSeenAt) < 7 * 86_400_000).map((m) => m.id))).size;

  const workspaceColumns: Column<AdminWorkspace>[] = [
    { key: "name", header: "Workspace", render: (w) => <span className="font-medium text-text">{w.name}</span>, sortValue: (w) => w.name },
    { key: "owner", header: "Owner", render: (w) => <span className="text-text-secondary">{w.ownerEmail ?? w.ownerId}</span>, sortValue: (w) => w.ownerEmail ?? "" },
    { key: "members", header: "Members", align: "right", render: (w) => w.members.length, sortValue: (w) => w.members.length },
    { key: "items", header: "Items", align: "right", render: (w) => w.counts.items, sortValue: (w) => w.counts.items },
    { key: "orders", header: "Orders", align: "right", render: (w) => w.counts.orders, sortValue: (w) => w.counts.orders },
    { key: "integrations", header: "Connected", render: (w) => <span className="text-text-secondary">{w.integrations.filter((i) => i.status !== "not_connected").map((i) => i.id).join(", ") || "—"}</span> },
    { key: "plan", header: "Plan", render: (w) => (w.subscription ? <Badge tone={w.subscription.status === "active" ? "success" : "attention"}>{w.subscription.status}</Badge> : <Badge tone="default">exempt</Badge>) },
    { key: "active", header: "Last activity", render: (w) => <span className="text-text-secondary">{w.lastActivityAt ? formatRelative(w.lastActivityAt) : "—"}</span>, sortValue: (w) => w.lastActivityAt ?? "" },
    { key: "created", header: "Created", render: (w) => <span className="text-text-secondary">{formatDate(w.createdAt)}</span>, sortValue: (w) => w.createdAt },
  ];

  const accountColumns: Column<AdminAccount>[] = [
    { key: "email", header: "Email", render: (a) => <span className="font-medium text-text">{a.email || (a.guest ? "guest" : "—")}</span>, sortValue: (a) => a.email },
    { key: "name", header: "Name", render: (a) => a.name, sortValue: (a) => a.name },
    { key: "business", header: "Business", render: (a) => (a.business ? a.business.skipped ? <span className="text-text-tertiary">skipped intake</span> : <span>{[a.business.name, a.business.industry, a.business.size].filter(Boolean).join(" · ")}</span> : <span className="text-text-tertiary">—</span>) },
    { key: "wants", header: "Wants", render: (a) => <span className="text-text-secondary">{a.business?.integrations?.filter((i) => i !== "none").join(", ") || "—"}</span> },
    { key: "workspaces", header: "Workspaces", align: "right", render: (a) => a.workspaceIds.length, sortValue: (a) => a.workspaceIds.length },
    { key: "created", header: "Signed up", render: (a) => <span className="text-text-secondary">{formatRelative(a.createdAt)}</span>, sortValue: (a) => a.createdAt },
  ];

  const subColumns: Column<AdminSubscription>[] = [
    { key: "email", header: "Email", render: (s) => <span className="font-medium text-text">{s.email}</span>, sortValue: (s) => s.email },
    { key: "status", header: "Status", render: (s) => <Badge tone={s.status === "active" ? "success" : s.status === "trialing" ? "info" : "attention"}>{s.status}</Badge>, sortValue: (s) => s.status },
    { key: "plan", header: "Plan", render: (s) => s.plan },
    { key: "workspace", header: "Workspace", render: (s) => s.workspaceName ?? <span className="text-text-tertiary">unclaimed</span> },
    { key: "renews", header: "Renews", render: (s) => <span className="text-text-secondary">{s.currentPeriodEnd ? formatDate(s.currentPeriodEnd) : "—"}</span>, sortValue: (s) => s.currentPeriodEnd ?? "" },
    { key: "created", header: "Started", render: (s) => <span className="text-text-secondary">{formatDate(s.createdAt)}</span>, sortValue: (s) => s.createdAt },
  ];

  const feedbackColumns: Column<AdminFeedback>[] = [
    { key: "kind", header: "Kind", render: (f) => <Badge tone={f.kind === "bug" ? "critical" : f.kind === "feature" ? "info" : "default"}>{f.kind === "feature" ? "feature request" : f.kind}</Badge>, sortValue: (f) => f.kind, width: "140px" },
    { key: "message", header: "Message", render: (f) => <span className="whitespace-pre-wrap text-text">{f.message}</span> },
    { key: "from", header: "From", render: (f) => <span className="text-text-secondary">{f.email}{f.workspaceName ? ` · ${f.workspaceName}` : ""}</span>, sortValue: (f) => f.email },
    { key: "page", header: "Page", render: (f) => <span className="font-mono text-[11.5px] text-text-tertiary">{f.page ?? "—"}</span> },
    { key: "when", header: "When", render: (f) => <span className="text-text-secondary">{formatRelative(f.createdAt)}</span>, sortValue: (f) => f.createdAt },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Accounts" value={data.accounts.length} hint={`${data.accounts.filter((a) => a.guest).length} guests`} />
        <Stat label="Workspaces" value={data.workspaces.length} hint={`${data.workspaces.reduce((n, w) => n + w.members.length, 0)} memberships`} />
        <Stat label="Paying" value={paying} hint={`${data.subscriptions.length} subscriptions total`} tone={paying ? "success" : "default"} />
        <Stat label="Active this week" value={seenThisWeek} hint="members seen in 7 days" />
      </div>

      <section>
        <Heading title="Workspaces" hint="Click a row for members, connections and plan." />
        <Table rows={data.workspaces} columns={workspaceColumns} rowKey={(w) => w.id} onRowClick={(w) => onOpen(w.id)} rowClassName={(w) => (w.id === open ? "bg-surface-selected" : "")} defaultSort={{ key: "created", dir: "desc" }} dense emptyState="No workspaces yet." />
        {selected && <WorkspaceDetail w={selected} />}
      </section>

      <section>
        <Heading title="Feedback and requests" hint="Sent from the sidebar chip. Newest first." />
        <Table rows={data.feedback} columns={feedbackColumns} rowKey={(f) => f.id} defaultSort={{ key: "when", dir: "desc" }} dense emptyState="Nothing sent yet." />
      </section>

      <section>
        <Heading title="Accounts" hint="Everyone who has signed up, with their welcome answers." />
        <Table rows={data.accounts} columns={accountColumns} rowKey={(a) => a.id} defaultSort={{ key: "created", dir: "desc" }} dense emptyState="No accounts yet." />
      </section>

      <section>
        <Heading title="Subscriptions" hint="Stripe records as the webhook last reported them." />
        <Table rows={data.subscriptions} columns={subColumns} rowKey={(s) => s.id} defaultSort={{ key: "created", dir: "desc" }} dense emptyState="No subscriptions yet." />
      </section>

      <p className="flex items-center gap-1.5 text-[11.5px] text-text-tertiary">
        <ShieldCheck className="h-3.5 w-3.5" /> Read-only. Generated {formatRelative(data.generatedAt)}.
      </p>
    </div>
  );
}

function Heading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-2.5">
      <h2 className="text-[14px] font-semibold text-text">{title}</h2>
      <p className="mt-0.5 text-[12.5px] text-text-secondary">{hint}</p>
    </div>
  );
}

function WorkspaceDetail({ w }: { w: AdminWorkspace }) {
  const memberColumns: Column<AdminWorkspace["members"][number]>[] = [
    { key: "name", header: "Member", render: (m) => <span className="font-medium text-text">{m.name}</span>, sortValue: (m) => m.name },
    { key: "email", header: "Email", render: (m) => <span className="text-text-secondary">{m.email}</span>, sortValue: (m) => m.email },
    { key: "role", header: "Role", render: (m) => <Badge tone={m.role === "owner" ? "info" : "default"}>{m.role}</Badge>, sortValue: (m) => m.role },
    { key: "status", header: "Status", render: (m) => m.status },
    { key: "seen", header: "Last seen", render: (m) => <span className="text-text-secondary">{m.lastSeenAt ? formatRelative(m.lastSeenAt) : "—"}</span>, sortValue: (m) => m.lastSeenAt ?? "" },
  ];
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Table rows={w.members} columns={memberColumns} rowKey={(m) => m.id} dense emptyState="No members." />
      <div className="card p-4">
        <DescriptionList
          rows={[
            { label: "Workspace id", value: <span className="font-mono text-[12px]">{w.id}</span> },
            { label: "Owner", value: w.ownerEmail ?? w.ownerId },
            { label: "Created", value: formatDate(w.createdAt) },
            { label: "Plan", value: w.subscription ? `${w.subscription.status} · ${w.subscription.plan}${w.subscription.currentPeriodEnd ? ` · renews ${formatDate(w.subscription.currentPeriodEnd)}` : ""}` : "Exempt (no subscription)" },
            { label: "Connections", value: w.integrations.length ? w.integrations.map((i) => `${i.id}: ${i.status}${i.lastSyncAt ? ` (synced ${formatRelative(i.lastSyncAt)})` : ""}`).join(" · ") : "None" },
            { label: "Data", value: `${w.counts.items} items · ${w.counts.orders} orders` },
          ]}
        />
      </div>
    </div>
  );
}
