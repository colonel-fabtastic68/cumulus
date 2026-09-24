"use client";

import { useCallback, useEffect, useState } from "react";
import { History, RotateCcw, Save, Trash2 } from "lucide-react";
import { useBackups, type BackupMeta } from "@/lib/backups";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/format";
import { Badge, Banner, Button, ConfirmDialog, EmptyState, IconButton, TextField, useToast, type BadgeTone } from "@/components/ui";

const KIND: Record<BackupMeta["kind"], { label: string; tone: BadgeTone }> = {
  manual: { label: "Manual", tone: "info" },
  auto: { label: "Daily", tone: "default" },
  "pre-restore": { label: "Safety", tone: "attention" },
};

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Time Machine: whole-workspace snapshots to roll back to. Owners and admins only. */
export function TimeMachineSection() {
  const backups = useBackups();
  const toast = useToast();
  const [list, setList] = useState<BackupMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<"create" | "restore" | "delete" | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<BackupMeta | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupMeta | null>(null);

  const refresh = useCallback(async () => {
    try {
      setList(await backups.list());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setList([]);
    }
  }, [backups]);

  // Loads after mount (the list comes from the server or this browser), not during render.
  useEffect(() => {
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);

  const create = async () => {
    setBusy("create");
    try {
      const b = await backups.create(label);
      toast(`Backed up ${formatNumber(b.docs)} records`, "success");
      setLabel("");
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    if (!restoreTarget) return;
    setBusy("restore");
    try {
      const r = await backups.restore(restoreTarget.id);
      toast(`Restored to ${formatDateTime(r.restored.createdAt)}. A safety backup of the previous state was kept.`, "success");
      setRestoreTarget(null);
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusy("delete");
    try {
      await backups.remove(deleteTarget.id);
      setDeleteTarget(null);
      await refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card flex flex-col gap-4 p-4">
      <p className="text-[13px] leading-5 text-text-secondary">
        {backups.where === "server"
          ? "A snapshot of everything in the workspace is taken every day when something changed, and whenever you press Back up now. Restoring puts every record back the way it was; the team keeps its access, and a safety backup of the current state is taken first so a restore can itself be undone."
          : "Local mode keeps up to ten snapshots in this browser. Restoring puts every record back the way it was, and a safety backup of the current state is taken first."}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <TextField label="Label" hint="(optional)" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Before the price update" onKeyDown={(e) => e.key === "Enter" && void create()} />
        </div>
        <Button variant="primary" icon={<Save />} onClick={() => void create()} loading={busy === "create"} disabled={busy !== null}>
          Back up now
        </Button>
      </div>
      {error && <Banner tone="critical">{error}</Banner>}
      {list === null ? (
        <p className="text-[12.5px] text-text-tertiary">Loading backups…</p>
      ) : list.length === 0 ? (
        <EmptyState icon={<History />} title="No backups yet" description={backups.where === "server" ? "The first daily backup arrives after the next change. Take one now to start the history." : "Take one now to start the history."} />
      ) : (
        <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">
          {list.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-text">
                  <span className="font-medium" title={formatDateTime(b.createdAt)}>
                    {formatDateTime(b.createdAt)}
                  </span>
                  <Badge tone={KIND[b.kind].tone}>{KIND[b.kind].label}</Badge>
                  {b.label && <span className="truncate text-text-secondary">{b.label}</span>}
                </div>
                <div className="text-[12px] text-text-tertiary">
                  {formatRelative(b.createdAt)} · {formatNumber(b.docs)} records · {size(b.bytes)}
                  {b.kind !== "auto" ? ` · by ${b.createdByName}` : ""}
                  {b.counts.items !== undefined ? ` · ${formatNumber(b.counts.items)} items, ${formatNumber(b.counts.orders ?? 0)} orders, ${formatNumber(b.counts.movements ?? 0)} movements` : ""}
                </div>
              </div>
              <Button size="sm" icon={<RotateCcw />} onClick={() => setRestoreTarget(b)} disabled={busy !== null}>
                Restore
              </Button>
              <IconButton size="sm" variant="plain" aria-label="Delete backup" title="Delete backup" className="text-text-tertiary hover:text-critical" onClick={() => setDeleteTarget(b)} disabled={busy !== null}>
                <Trash2 className="h-3.5 w-3.5" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!restoreTarget}
        onClose={() => setRestoreTarget(null)}
        onConfirm={restore}
        loading={busy === "restore"}
        destructive
        confirmLabel="Restore this backup"
        title={restoreTarget ? `Restore the workspace to ${formatDateTime(restoreTarget.createdAt)}?` : "Restore?"}
        message={
          restoreTarget ? (
            <span>
              Every item, movement, order, receipt and setting goes back to how it was then ({formatNumber(restoreTarget.docs)} records). Anything changed since, including today&apos;s receipts and orders, is replaced. Team members keep their access. A safety backup of the current state is taken first, so this can be undone from the same list.
            </span>
          ) : null
        }
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={remove}
        loading={busy === "delete"}
        destructive
        confirmLabel="Delete"
        title={deleteTarget ? `Delete the backup from ${formatDateTime(deleteTarget.createdAt)}?` : "Delete?"}
        message={<span>It cannot be restored afterwards. Other backups are not affected.</span>}
      />
    </div>
  );
}
