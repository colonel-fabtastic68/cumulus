"use client";

import { useState } from "react";
import { Undo2 } from "lucide-react";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { bomImportRecord, bomImportRevertOf, revertBomImport } from "@/lib/bomImport";
import { useCollection, useStore } from "@/lib/store/provider";
import { useFeature } from "@/lib/useFeature";
import { Button, ConfirmDialog, useToast } from "@/components/ui";

/**
 * "Revert this import" for a parts list import (feature `bomImport`): on the import's Done screen
 * and on its Activity entry. Shows "Reverted" once it has been, and nothing for other entries.
 */
export function RevertBomImport({ activityId, size = "sm" }: { activityId: string; size?: "sm" | "md" }) {
  const enabled = useFeature("bomImport");
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const activity = useCollection("activity");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const event = activity.find((a) => a.id === activityId);
  const record = bomImportRecord(event);
  if (!enabled || !record) return null;
  if (bomImportRevertOf(activity, activityId)) return <span className="text-[12px] text-text-tertiary">Reverted</span>;
  if (!canWrite(user)) return null;

  const run = async () => {
    setBusy(true);
    try {
      const r = await revertBomImport(store, user, activityId);
      toast(`Put back the parts lists of ${r.restored} assembl${r.restored === 1 ? "y" : "ies"}`, "success");
      setConfirming(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const n = record.assemblies.length;
  const made = record.assemblies.filter((a) => a.becameAssembly).length;
  return (
    <>
      <Button size={size} icon={<Undo2 />} onClick={() => setConfirming(true)}>
        Revert this import
      </Button>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void run()}
        loading={busy}
        title="Revert this import?"
        message={`${n} assembl${n === 1 ? "y goes" : "ies go"} back to the parts list ${n === 1 ? "it" : "they"} had before the import from ${record.source}${made ? `, and ${made} part${made === 1 ? "" : "s"} the import made assemblies go back to being parts` : ""}. Not possible once one of them has been built or its list edited since.`}
        confirmLabel="Revert import"
      />
    </>
  );
}
