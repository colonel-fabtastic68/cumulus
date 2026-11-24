"use client";

import { useState } from "react";
import { CheckCircle2, Play, Plus, SkipForward, Trash2 } from "lucide-react";
import type { WorkOrder } from "@/lib/types";
import { addWorkOrderStep, advanceWorkOrderStep, removeWorkOrderStep, workOrderIsOpen, type StepAction } from "@/lib/workOrders";
import { currentStep, STEP_STATUS_LABEL, stepIsLate, stepsProgress, stepStatusLine } from "@/lib/workOrderSteps";
import { useCollection, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Button, IconButton, useToast } from "@/components/ui";
import { SerialLink, SerialStatusBadge } from "@/components/serials/SerialStatusBadge";

/** The run's steps, worked in order (feature `workOrderSteps`). */
export function WorkOrderStepsPanel({ wo, canWrite }: { wo: WorkOrder; canWrite: boolean }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const members = useCollection("members");
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [where, setWhere] = useState("");
  const [outside, setOutside] = useState(false);
  const steps = wo.steps ?? [];
  const open = workOrderIsOpen(wo);
  const current = currentStep(wo);
  const progress = stepsProgress(wo);
  const line = stepStatusLine(wo);
  const canAct = canWrite && open && wo.status !== "planned";

  const act = async (stepId: string, action: StepAction) => {
    setBusy(`${stepId}:${action}`);
    try {
      await advanceWorkOrderStep(store, user, wo.id, stepId, action);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(null);
    }
  };
  const remove = async (stepId: string) => {
    try {
      await removeWorkOrderStep(store, user, wo.id, stepId);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    }
  };
  const add = async () => {
    try {
      await addWorkOrderStep(store, user, wo.id, { name, workCenter: where, outside });
      setName("");
      setWhere("");
      setOutside(false);
      setAdding(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    }
  };

  if (steps.length === 0 && !(canWrite && open)) return null;
  const input = "h-8 rounded-[var(--radius-sm)] border border-border-strong/70 bg-surface px-2 text-[13px] outline-none placeholder:text-text-tertiary focus:border-accent focus:ring-2 focus:ring-accent/20";

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <span className="font-semibold text-text">Steps</span>
        {steps.length > 0 && (
          <span className="text-[12.5px] text-text-secondary">
            {progress.done} of {progress.total} done{line ? ` · ${line}` : ""}
          </span>
        )}
      </div>
      {steps.length > 0 && (
        <ol className="divide-y divide-border rounded-[var(--radius)] border border-border">
          {steps.map((s, i) => {
            const isCurrent = current?.id === s.id;
            const late = stepIsLate(s);
            const who = s.finishedBy ? members.find((m) => m.id === s.finishedBy)?.name : undefined;
            return (
              <li key={s.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[12.5px]", isCurrent && "bg-surface-subdued")}>
                <span className="w-5 text-right tabular text-text-tertiary">{i + 1}</span>
                <span className="min-w-[140px] flex-1">
                  <span className={cn("font-medium", s.status === "skipped" ? "text-text-tertiary line-through" : "text-text")}>{s.name}</span>
                  {s.workCenter && <span className="text-text-secondary"> · {s.workCenter}</span>}
                  {s.outside && <Badge tone="attention" className="ml-1.5">Outside</Badge>}
                  <span className="block text-[12px] text-text-tertiary">
                    {s.status === "done" || s.status === "skipped"
                      ? `${STEP_STATUS_LABEL[s.status]} ${formatDateTime(s.finishedAt)}${who ? ` by ${who}` : ""}`
                      : s.status === "in_progress"
                        ? `Started ${formatDateTime(s.startedAt)}${s.plannedFinish ? ` · due ${formatDate(s.plannedFinish)}` : ""}`
                        : s.plannedStart
                          ? `Planned ${formatDate(s.plannedStart)}${s.plannedFinish && s.plannedFinish !== s.plannedStart ? ` to ${formatDate(s.plannedFinish)}` : ""}`
                          : "Not started"}
                  </span>
                </span>
                {late && <Badge tone="warning">Late</Badge>}
                {s.status === "done" && <Badge tone="success">Done</Badge>}
                {isCurrent && canAct && (
                  <span className="flex items-center gap-1">
                    {s.status === "pending" && (
                      <Button size="sm" icon={<Play />} loading={busy === `${s.id}:start`} disabled={!!busy} onClick={() => void act(s.id, "start")}>
                        Start
                      </Button>
                    )}
                    <Button size="sm" variant="primary" icon={<CheckCircle2 />} loading={busy === `${s.id}:finish`} disabled={!!busy} onClick={() => void act(s.id, "finish")}>
                      Finish
                    </Button>
                    <Button size="sm" variant="plain" icon={<SkipForward />} loading={busy === `${s.id}:skip`} disabled={!!busy} onClick={() => void act(s.id, "skip")}>
                      Skip
                    </Button>
                  </span>
                )}
                {canWrite && open && s.status === "pending" && !isCurrent && (
                  <IconButton variant="plain" size="sm" onClick={() => void remove(s.id)} className="text-text-tertiary hover:text-critical" aria-label={`Remove ${s.name}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </IconButton>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {wo.status === "planned" && steps.length > 0 && <p className="mt-1 text-[12px] text-text-tertiary">Release the run to start working its steps.</p>}
      {canWrite && open &&
        (adding ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input className={cn(input, "w-40")} value={name} onChange={(e) => setName(e.target.value)} placeholder="Step, e.g. Weld" aria-label="New step name" autoFocus />
            <input className={cn(input, "w-36")} value={where} onChange={(e) => setWhere(e.target.value)} placeholder="Where (optional)" aria-label="New step work center" />
            <label className="inline-flex items-center gap-1 text-[12.5px] text-text-secondary">
              <input type="checkbox" checked={outside} onChange={(e) => setOutside(e.target.checked)} /> Outside
            </label>
            <Button size="sm" variant="primary" disabled={!name.trim()} onClick={() => void add()}>
              Add
            </Button>
            <Button size="sm" variant="plain" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="plain" icon={<Plus />} className="mt-1.5" onClick={() => setAdding(true)}>
            {steps.length ? "Add a step" : "Add steps to this run"}
          </Button>
        ))}
    </div>
  );
}

/** The serial numbers of the units this run makes (feature `serials`). */
export function WorkOrderSerials({ wo }: { wo: WorkOrder }) {
  const serials = useCollection("serials");
  const mine = (wo.serialIds ?? []).map((id) => serials.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s);
  if (mine.length === 0) return null;
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-semibold text-text">Serial numbers</div>
      <ul className="flex flex-wrap gap-2">
        {mine.map((s) => (
          <li key={s.id} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border px-2 py-1">
            <SerialLink serial={s} />
            <SerialStatusBadge status={s.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
