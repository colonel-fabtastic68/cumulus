"use client";

import { useState } from "react";
import type { WorkspaceSettings } from "@/lib/types";
import { TextField, Toggle, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { SettingsCard } from "./SettingsCard";
import { useSaveSettings } from "./useSaveSettings";

type RelievePolicy = WorkspaceSettings["relievePolicy"];

const POLICIES: Array<{ value: RelievePolicy; title: string; description: string }> = [
  {
    value: "on_build",
    title: "Relieve on build",
    description: "Components leave stock the moment an assembly is built. Finished goods sit on the shelf until they ship.",
  },
  {
    value: "on_fulfill",
    title: "Relieve on fulfilment",
    description: "If the assembly is not on the shelf when an order ships, its components are relieved at that point instead.",
  },
];

function PolicyOption({ option, selected, disabled, onSelect }: { option: (typeof POLICIES)[number]; selected: boolean; disabled: boolean; onSelect: () => void }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-[var(--radius)] border p-3 transition-colors",
        selected ? "border-accent bg-surface-selected" : "border-border bg-surface hover:bg-surface-hover",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input type="radio" name="relievePolicy" value={option.value} checked={selected} disabled={disabled} onChange={onSelect} className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--accent)]" />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-text">{option.title}</span>
        <span className="mt-0.5 block text-[12px] leading-[1.45] text-text-secondary">{option.description}</span>
      </span>
    </label>
  );
}

export function InventoryPolicySection({ settings, readOnly }: { settings: WorkspaceSettings; readOnly: boolean }) {
  const saveSettings = useSaveSettings();
  const toast = useToast();
  const [trackInUse, setTrackInUse] = useState(settings.trackInUse);
  const [relievePolicy, setRelievePolicy] = useState<RelievePolicy>(settings.relievePolicy);
  const [inactivityDays, setInactivityDays] = useState(String(settings.inactivityDays));
  const [saving, setSaving] = useState(false);

  const days = Number(inactivityDays);
  const daysError = !inactivityDays.trim() || !Number.isInteger(days) || days < 1 ? "Enter a whole number of days (1 or more)" : undefined;
  const dirty = trackInUse !== settings.trackInUse || relievePolicy !== settings.relievePolicy || days !== settings.inactivityDays;

  const save = async () => {
    if (daysError) return;
    setSaving(true);
    try {
      await saveSettings({ trackInUse, relievePolicy, inactivityDays: days });
      toast("Inventory policy saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save settings", "critical");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsCard onSave={() => void save()} saving={saving} dirty={dirty && !daysError} readOnly={readOnly} footerNote={dirty ? "Unsaved changes" : undefined}>
      <Toggle
        label="Track in-use quantities"
        help="Keep a separate bucket for parts checked out to a job but not yet consumed, so on-hand always means on the shelf."
        checked={trackInUse}
        onChange={setTrackInUse}
        disabled={readOnly}
      />

      <div>
        <div className="mb-1 text-[12.5px] font-medium text-text">When components are relieved</div>
        <p className="mb-2 text-[12px] text-text-tertiary">Decides when a build takes parts out of stock. Either way every change is a ledger movement.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Relieve policy">
          {POLICIES.map((p) => (
            <PolicyOption key={p.value} option={p} selected={relievePolicy === p.value} disabled={readOnly} onSelect={() => setRelievePolicy(p.value)} />
          ))}
        </div>
      </div>

      <TextField
        label="Inactivity window"
        type="number"
        min={1}
        step={1}
        inputMode="numeric"
        value={inactivityDays}
        onChange={(e) => setInactivityDays(e.target.value)}
        suffix="days"
        error={daysError}
        help="Items with no stock movement for this long are flagged as inactive on reports and by the agent."
        disabled={readOnly}
        containerClassName="sm:max-w-[240px]"
      />
    </SettingsCard>
  );
}
