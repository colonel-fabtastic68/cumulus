"use client";

import { useState } from "react";
import { Lock, LockOpen } from "lucide-react";
import type { WorkspaceSettings } from "@/lib/types";
import { closePeriod, lastMonthEnd, lastQuarterEnd, reopenPeriod } from "@/lib/periodLock";
import { useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { formatDate, formatDateTime, toDateInput } from "@/lib/format";
import { Badge, Button, ConfirmDialog, FormGrid, TextField, useToast } from "@/components/ui";
import { SettingsCard } from "./SettingsCard";

/**
 * Period close (feature "periodLocks"): owners and admins close the books
 * through a date; the ledger then refuses stock movements dated on or before it.
 */
export function PeriodCloseSection({ settings, canManage }: { settings: WorkspaceSettings; canManage: boolean }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const lock = settings.periodLock;
  const [through, setThrough] = useState(() => lastMonthEnd());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  // The latest day that can be closed, fixed when the card opens.
  const [yesterday] = useState(() => toDateInput(new Date(Date.now() - 86_400_000).toISOString()));

  const close = async () => {
    setBusy(true);
    try {
      const l = await closePeriod(store, user, through, note);
      toast(`Books closed through ${formatDate(l.through)}`, "success");
      setNote("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not close the period", "critical");
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    setBusy(true);
    try {
      await reopenPeriod(store, user);
      toast("Books reopened", "success");
      setConfirmReopen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not reopen the period", "critical");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-medium text-text">Period close</h3>
            {lock ? (
              <Badge tone="attention">
                <Lock className="h-3 w-3" /> Closed through {formatDate(lock.through)}
              </Badge>
            ) : (
              <Badge tone="default">Open</Badge>
            )}
          </div>
          <p className="mt-0.5 text-[12.5px] text-text-secondary">
            {lock
              ? `Receipts, adjustments, builds and shipments cannot be dated on or before ${formatDate(lock.through)}. Closed ${formatDateTime(lock.lockedAt)}${lock.lockedByName ? ` by ${lock.lockedByName}` : ""}${lock.note ? ` · ${lock.note}` : ""}.`
              : "Once a month or quarter is reported, close it: nothing can then be back-dated into it, so the numbers you reported stay the numbers."}
          </p>
        </div>
        {lock && canManage && (
          <Button icon={<LockOpen />} onClick={() => setConfirmReopen(true)}>
            Reopen
          </Button>
        )}
      </div>
      {canManage ? (
        <>
          <FormGrid cols={3}>
            <TextField label={lock ? "Move the close to" : "Close through"} type="date" value={through} max={yesterday} onChange={(e) => setThrough(e.target.value)} />
            <div className="sm:col-span-2">
              <TextField label="Note" hint="(optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="October reported to the accountant" />
            </div>
          </FormGrid>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={<Lock />} onClick={() => void close()} loading={busy} disabled={!through || through === lock?.through}>
              Close the books
            </Button>
            <Button variant="plain" onClick={() => setThrough(lastMonthEnd())}>
              End of last month
            </Button>
            <Button variant="plain" onClick={() => setThrough(lastQuarterEnd())}>
              End of last quarter
            </Button>
          </div>
        </>
      ) : (
        <p className="text-[12px] text-text-tertiary">Only owners and admins can close or reopen a period.</p>
      )}
      <ConfirmDialog
        open={confirmReopen}
        onClose={() => setConfirmReopen(false)}
        onConfirm={() => void reopen()}
        loading={busy}
        title="Reopen the books?"
        confirmLabel="Reopen"
        message={lock ? `Movements can again be dated on or before ${formatDate(lock.through)}. Reports for that period may change. The reopening is logged in Activity.` : undefined}
      />
    </SettingsCard>
  );
}
