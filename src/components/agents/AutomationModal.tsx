"use client";

import { useState } from "react";
import type { AgentAutomation } from "@/lib/types";
import { newId } from "@/lib/utils";
import { Button, ConfirmDialog, Modal, Select, TextArea, TextField } from "@/components/ui";

export const SCHEDULE_OPTIONS: Array<{ value: AgentAutomation["schedule"]; label: string }> = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "manual", label: "Manual (run on demand)" },
];

interface AutomationModalProps {
  open: boolean;
  onClose: () => void;
  /** Existing automation to edit. Omit to create a new one. */
  automation?: AgentAutomation;
  onSave: (automation: AgentAutomation) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

/** Gate: mounts the form only while open so every open starts from fresh state. */
export function AutomationModal(props: AutomationModalProps) {
  if (!props.open) return null;
  return <AutomationForm {...props} />;
}

function AutomationForm({ onClose, automation, onSave, onDelete }: AutomationModalProps) {
  const isNew = !automation;
  const [name, setName] = useState(automation?.name ?? "");
  const [description, setDescription] = useState(automation?.description ?? "");
  const [prompt, setPrompt] = useState(automation?.prompt ?? "");
  const [schedule, setSchedule] = useState<AgentAutomation["schedule"]>(automation?.schedule ?? "weekly");
  const [enabled, setEnabled] = useState(automation?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [touched, setTouched] = useState(false);

  const nameError = touched && !name.trim() ? "Give the automation a name" : undefined;
  const promptError = touched && !prompt.trim() ? "Tell Nimbus what to do" : undefined;
  const valid = name.trim().length > 0 && prompt.trim().length > 0;

  const submit = async () => {
    setTouched(true);
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onSave({
        id: automation?.id ?? newId("auto"),
        name: name.trim(),
        description: description.trim(),
        prompt: prompt.trim(),
        schedule,
        enabled,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!automation || !onDelete) return;
    setDeleting(true);
    try {
      await onDelete(automation.id);
      setConfirmDelete(false);
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Modal
        open
        onClose={onClose}
        title={isNew ? "New automation" : "Edit automation"}
        subtitle="A saved prompt Nimbus runs on a schedule or on demand."
        footer={
          <>
            {!isNew && onDelete && (
              <Button variant="plain" className="mr-auto text-critical hover:bg-critical-soft" onClick={() => setConfirmDelete(true)} disabled={saving}>
                Delete
              </Button>
            )}
            <Button onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={saving} disabled={touched && !valid}>
              {isNew ? "Create automation" : "Save changes"}
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Daily low-stock digest" error={nameError} autoFocus />
          <TextField label="Description" hint="optional" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One line on what this does and why" />
          <TextArea
            label="Prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Review all items below minimum quantity and recommend reorder quantities grouped by supplier…"
            rows={5}
            error={promptError}
            help={promptError ? undefined : "Written as if you typed it into Nimbus. Be precise about scope and what to do with the result."}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="Schedule" value={schedule} onChange={(e) => setSchedule(e.target.value as AgentAutomation["schedule"])} options={SCHEDULE_OPTIONS} />
            <Select
              label="Status"
              value={enabled ? "on" : "off"}
              onChange={(e) => setEnabled(e.target.value === "on")}
              options={[
                { value: "on", label: "Enabled" },
                { value: "off", label: "Paused" },
              ]}
            />
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title="Delete this automation?"
        message={`"${automation?.name ?? ""}" will be removed from the workspace. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        loading={deleting}
      />
    </>
  );
}
