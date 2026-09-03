"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { ChevronDown, ChevronRight, Database, Download, Eraser, RotateCcw, Upload } from "lucide-react";
import { COLLECTIONS, type Member, type WorkspaceSettings, type WorkspaceSnapshot } from "@/lib/types";
import { Badge, Button, ConfirmDialog, useToast } from "@/components/ui";
import { useCollection, useStore } from "@/lib/store/provider";
import { useAuth } from "@/lib/auth";
import { buildEmpty, buildSeed } from "@/lib/seed";
import { formatNumber } from "@/lib/format";
import { toDateInput } from "@/lib/format";

const WORKSPACE_ID = process.env.NEXT_PUBLIC_CUMULUS_WORKSPACE ?? "default";

const FIREBASE_VARS = [
  ["NEXT_PUBLIC_FIREBASE_API_KEY", "required"],
  ["NEXT_PUBLIC_FIREBASE_PROJECT_ID", "required"],
  ["NEXT_PUBLIC_FIREBASE_APP_ID", "required"],
  ["NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "optional, defaults to <project>.firebaseapp.com"],
  ["NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "optional"],
  ["NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID", "optional"],
  ["NEXT_PUBLIC_CUMULUS_WORKSPACE", "optional, workspace id under /workspaces (defaults to \"default\")"],
] as const;

type PendingAction = { kind: "import"; snapshot: WorkspaceSnapshot; fileName: string } | { kind: "reset" } | { kind: "clear" } | null;

/** Turn parsed JSON into a full snapshot: every collection present, unknown keys dropped. */
function normaliseSnapshot(raw: Record<string, unknown>): WorkspaceSnapshot {
  const out = {} as Record<string, unknown[]>;
  for (const c of COLLECTIONS) {
    const rows = raw[c];
    out[c] = Array.isArray(rows) ? rows : [];
  }
  return out as unknown as WorkspaceSnapshot;
}

/** Keep the people who already have access when the rest of the workspace is replaced. */
function keepTeam(snapshot: WorkspaceSnapshot, current: Member[]): WorkspaceSnapshot {
  if (current.length === 0) return snapshot;
  const ids = new Set(snapshot.members.map((m) => m.id));
  const extra = current.filter((m) => !ids.has(m.id));
  return { ...snapshot, members: [...snapshot.members, ...extra] };
}

function summarise(s: WorkspaceSnapshot): string {
  const parts = [
    `${formatNumber(s.items.length)} items`,
    `${formatNumber(s.movements.length)} movements`,
    `${formatNumber(s.suppliers.length)} suppliers`,
    `${formatNumber(s.orders.length)} orders`,
    `${formatNumber(s.rmas.length)} returns`,
    `${formatNumber(s.members.length)} members`,
  ];
  return parts.join(", ");
}

export function DataSection({ settings, canManage }: { settings: WorkspaceSettings; canManage: boolean }) {
  const store = useStore();
  const members = useCollection("members");
  const items = useCollection("items");
  const { mode } = useAuth();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showFirestore, setShowFirestore] = useState(false);

  const exportJson = async () => {
    setExporting(true);
    try {
      const snapshot = await store.snapshot();
      const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cumulus-export-${toDateInput()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast("Workspace exported", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not export the workspace", "critical");
    } finally {
      setExporting(false);
    }
  };

  const onFileChosen = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("That file is not a Cumulus export (expected a JSON object).");
      const raw = parsed as Record<string, unknown>;
      if (!Array.isArray(raw.items)) throw new Error("That file is not a Cumulus export (no items array).");
      let snapshot = normaliseSnapshot(raw);
      // Never import a workspace nobody can sign in to, and keep settings sane.
      snapshot = keepTeam(snapshot, snapshot.members.length === 0 ? members : []);
      if (snapshot.settings.length === 0) snapshot = { ...snapshot, settings: [settings] };
      setPending({ kind: "import", snapshot, fileName: file.name });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not read that file", "critical");
    }
  };

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "import") {
        await store.replaceAll(pending.snapshot);
        toast(`Imported ${pending.fileName}: ${summarise(pending.snapshot)}`, "success");
      } else if (pending.kind === "reset") {
        await store.replaceAll(mode === "firestore" ? keepTeam(buildSeed(), members) : buildSeed());
        toast("Demo data restored", "success");
      } else {
        await store.replaceAll(keepTeam({ ...buildEmpty(), members: [] }, members));
        toast("Workspace cleared", "success");
      }
      setPending(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong", "critical");
    } finally {
      setBusy(false);
    }
  };

  const disabledHelp = canManage ? undefined : "Only owners and admins can export, import or reset data.";

  return (
    <div className="card flex flex-col gap-4 p-4">
      <dl className="grid grid-cols-[minmax(110px,max-content)_1fr] gap-x-6 gap-y-2 text-[13px]">
        <dt className="text-text-secondary">Backend</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {mode === "firestore" ? <Badge tone="success" dot>Google Cloud Firestore</Badge> : <Badge tone="info" dot>Local browser storage</Badge>}
          <span className="text-[12px] text-text-tertiary">{mode === "firestore" ? "Shared in real time across every signed-in user." : "Data lives in this browser only. Two tabs stay in sync."}</span>
        </dd>
        <dt className="text-text-secondary">Workspace id</dt>
        <dd>
          <code className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[12px] text-text">{WORKSPACE_ID}</code>
        </dd>
        <dt className="text-text-secondary">Contents</dt>
        <dd className="text-text-secondary">
          {formatNumber(items.length)} {items.length === 1 ? "item" : "items"}, {formatNumber(members.length)} {members.length === 1 ? "member" : "members"}
        </dd>
      </dl>

      <div className="border-t border-border pt-4">
        <div className="mb-2 text-[12.5px] font-medium text-text">Backup and restore</div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<Download />} onClick={() => void exportJson()} loading={exporting} disabled={!canManage}>
            Export workspace JSON
          </Button>
          <Button icon={<Upload />} onClick={() => fileRef.current?.click()} disabled={!canManage}>
            Import workspace JSON
          </Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void onFileChosen(e)} />
        </div>
        <p className="mt-1.5 text-[12px] text-text-tertiary">{disabledHelp ?? "Exports contain every collection. Importing replaces the whole workspace with the file."}</p>
      </div>

      <div className="border-t border-border pt-4">
        <div className="mb-2 text-[12.5px] font-medium text-text">Start over</div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<RotateCcw />} onClick={() => setPending({ kind: "reset" })} disabled={!canManage}>
            Reset demo data
          </Button>
          <Button variant="critical" icon={<Eraser />} onClick={() => setPending({ kind: "clear" })} disabled={!canManage}>
            Clear workspace
          </Button>
        </div>
        <p className="mt-1.5 text-[12px] text-text-tertiary">{disabledHelp ?? "Reset brings back Halcyon Audio with six months of history. Clear leaves an empty workspace with your team and settings."}</p>
      </div>

      <div className="border-t border-border pt-4">
        <button type="button" onClick={() => setShowFirestore((v) => !v)} className="flex w-full items-center gap-1.5 text-left text-[12.5px] font-medium text-text hover:text-accent" aria-expanded={showFirestore}>
          {showFirestore ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <Database className="h-3.5 w-3.5 text-text-tertiary" />
          Connect Firestore
          {mode === "firestore" && <Badge tone="success">Connected</Badge>}
        </button>
        {showFirestore && (
          <div className="mt-3 flex flex-col gap-3 text-[12.5px] text-text-secondary">
            <ol className="list-decimal space-y-1 pl-5">
              <li>Create a Firebase project and enable Firestore plus Google sign-in under Authentication.</li>
              <li>Register a Web app and copy its config into .env.local using the variables below.</li>
              <li>Restart the dev server. The workspace is seeded on first load; use Export first to carry your local data across, then Import.</li>
            </ol>
            <div className="overflow-x-auto rounded-[var(--radius)] border border-border bg-surface-subdued p-3">
              <table className="w-full text-[12px]">
                <tbody>
                  {FIREBASE_VARS.map(([name, note]) => (
                    <tr key={name}>
                      <td className="whitespace-nowrap py-0.5 pr-4 font-mono text-text">{name}</td>
                      <td className="py-0.5 text-text-tertiary">{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[12px] text-text-tertiary">
              For a pilot, Firestore rules can be <code className="rounded bg-surface-hover px-1 font-mono">allow read, write: if request.auth != null;</code>. Every collection lives under{" "}
              <code className="rounded bg-surface-hover px-1 font-mono">workspaces/{WORKSPACE_ID}/…</code>.
            </p>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pending?.kind === "import"}
        onClose={() => (busy ? undefined : setPending(null))}
        onConfirm={() => void run()}
        title="Replace the workspace with this file?"
        message={
          pending?.kind === "import" ? (
            <>
              <span className="font-medium text-text">{pending.fileName}</span> contains {summarise(pending.snapshot)}. Everything currently in the workspace will be replaced. Export first if you want a copy of what is here now.
            </>
          ) : null
        }
        confirmLabel="Import and replace"
        loading={busy}
      />
      <ConfirmDialog
        open={pending?.kind === "reset"}
        onClose={() => (busy ? undefined : setPending(null))}
        onConfirm={() => void run()}
        title="Reset to demo data?"
        message="Everything in the workspace is replaced with the Halcyon Audio demo: items, history, orders, returns and settings. This cannot be undone unless you exported first."
        confirmLabel="Reset demo data"
        loading={busy}
      />
      <ConfirmDialog
        open={pending?.kind === "clear"}
        onClose={() => (busy ? undefined : setPending(null))}
        onConfirm={() => void run()}
        title="Clear the whole workspace?"
        message="All items, stock history, suppliers, orders, returns and agent conversations are deleted. Your team and settings are kept. This cannot be undone unless you exported first."
        confirmLabel="Clear workspace"
        destructive
        loading={busy}
      />
    </div>
  );
}
