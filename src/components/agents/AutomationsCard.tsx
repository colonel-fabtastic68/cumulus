"use client";

import { useState } from "react";
import { CalendarClock, Info, Pencil, Play, Plus } from "lucide-react";
import type { AgentAutomation } from "@/lib/types";
import { Badge, Button, Card, CardHeader, EmptyState, Toggle, useToast, type BadgeTone } from "@/components/ui";
import { useSettings } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { AutomationModal } from "./AutomationModal";
import { useSaveSettings } from "./useSaveSettings";

const SCHEDULE_LABEL: Record<AgentAutomation["schedule"], string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly", manual: "Manual" };
const SCHEDULE_TONE: Record<AgentAutomation["schedule"], BadgeTone> = { daily: "info", weekly: "accent", monthly: "default", manual: "default" };

type Editing = { mode: "new" } | { mode: "edit"; automation: AgentAutomation } | null;

export function AutomationsCard() {
  const settings = useSettings();
  const user = useCurrentUser();
  const toast = useToast();
  const saveSettings = useSaveSettings();
  const { open } = useAgent();
  const [editing, setEditing] = useState<Editing>(null);

  const automations = settings.automations ?? [];
  const writable = canWrite(user);

  const persist = async (next: AgentAutomation[], successMessage: string) => {
    try {
      await saveSettings({ automations: next });
      toast(successMessage, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save automations", "critical");
      throw e;
    }
  };

  const setEnabled = (id: string, enabled: boolean) => {
    const target = automations.find((a) => a.id === id);
    void persist(
      automations.map((a) => (a.id === id ? { ...a, enabled } : a)),
      `${target?.name ?? "Automation"} ${enabled ? "enabled" : "paused"}`,
    ).catch(() => {});
  };

  const save = async (automation: AgentAutomation) => {
    const exists = automations.some((a) => a.id === automation.id);
    const next = exists ? automations.map((a) => (a.id === automation.id ? automation : a)) : [...automations, automation];
    await persist(next, exists ? "Automation updated" : "Automation created");
  };

  const remove = async (id: string) => {
    await persist(
      automations.filter((a) => a.id !== id),
      "Automation deleted",
    );
  };

  const runNow = (a: AgentAutomation) => open(a.prompt, { send: true });

  return (
    <Card padded={false} className="flex flex-col">
      <div className="px-4 pt-4">
        <CardHeader
          title="Automations"
          subtitle={automations.length ? `${automations.filter((a) => a.enabled).length} of ${automations.length} enabled` : "Saved prompts Nimbus runs on a schedule."}
          actions={
            <Button size="sm" icon={<Plus />} onClick={() => setEditing({ mode: "new" })} disabled={!writable}>
              New automation
            </Button>
          }
        />
      </div>
      {automations.length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title="No automations yet"
          description="Save a prompt like a weekly dead-stock sweep or a daily reorder digest and run it whenever you need."
          action={
            <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setEditing({ mode: "new" })} disabled={!writable}>
              New automation
            </Button>
          }
          className="py-8"
        />
      ) : (
        <ul className="divide-y divide-border">
          {automations.map((a) => (
            <li key={a.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-medium text-text">{a.name}</span>
                  <Badge tone={SCHEDULE_TONE[a.schedule]}>{SCHEDULE_LABEL[a.schedule]}</Badge>
                  {!a.enabled && <Badge tone="default">Paused</Badge>}
                </div>
                {a.description && <p className="mt-0.5 text-[12.5px] text-text-secondary">{a.description}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Toggle checked={a.enabled} onChange={(v) => setEnabled(a.id, v)} disabled={!writable} />
                <Button size="sm" icon={<Play />} onClick={() => runNow(a)}>
                  Run now
                </Button>
                <Button size="sm" variant="plain" icon={<Pencil />} onClick={() => setEditing({ mode: "edit", automation: a })} disabled={!writable} aria-label={`Edit ${a.name}`}>
                  Edit
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-auto flex items-start gap-2 border-t border-border px-4 py-2.5 text-[12px] text-text-tertiary">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Schedules are saved with the workspace. In the pilot, run them on demand or when you open Cumulus.</span>
      </div>

      <AutomationModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        automation={editing?.mode === "edit" ? editing.automation : undefined}
        onSave={save}
        onDelete={editing?.mode === "edit" ? remove : undefined}
      />
    </Card>
  );
}
