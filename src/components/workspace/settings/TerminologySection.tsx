"use client";

import { useState } from "react";
import type { WorkspaceSettings } from "@/lib/types";
import { DEFAULT_TERMS, ITEM_CODE_PRESETS, termsFor } from "@/lib/terminology";
import { FormGrid, Select, TextField, useToast } from "@/components/ui";
import { SettingsCard } from "./SettingsCard";
import { useSaveSettings } from "./useSaveSettings";

const CUSTOM = "__custom";

/** What the workspace calls the item code: SKU, part number, or its own word (feature "partNumbers"). */
export function TerminologySection({ settings, readOnly }: { settings: WorkspaceSettings; readOnly: boolean }) {
  const saveSettings = useSaveSettings();
  const toast = useToast();
  const current = termsFor(settings);
  const isPreset = ITEM_CODE_PRESETS.some((p) => p.itemCode === current.itemCode);
  const [choice, setChoice] = useState(isPreset ? current.itemCode : CUSTOM);
  const [custom, setCustom] = useState(isPreset ? "" : current.itemCode);
  const [short, setShort] = useState(isPreset ? "" : current.itemCodeShort);
  const [saving, setSaving] = useState(false);

  const itemCode = choice === CUSTOM ? custom.trim() : choice;
  const next = termsFor({ terminology: { itemCode, itemCodeShort: choice === CUSTOM ? short.trim() || undefined : undefined } });
  const dirty = next.itemCode !== current.itemCode || next.itemCodeShort !== current.itemCodeShort;

  const save = async () => {
    if (choice === CUSTOM && !custom.trim()) return toast("Type the word you use, or pick one from the list", "critical");
    setSaving(true);
    try {
      // The default needs no record at all.
      await saveSettings({ terminology: next.itemCode === DEFAULT_TERMS.itemCode ? undefined : { itemCode: next.itemCode, itemCodeShort: next.itemCodeShort } });
      toast(`Item codes are now called “${next.itemCode}”`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save settings", "critical");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsCard onSave={() => void save()} saving={saving} dirty={dirty} readOnly={readOnly} footerNote={dirty ? "Unsaved changes" : undefined}>
      <div>
        <h3 className="text-[13px] font-medium text-text">What you call an item code</h3>
        <p className="mt-0.5 text-[12.5px] text-text-secondary">Used on lists, forms, prints and emails. Nothing about the items themselves changes.</p>
      </div>
      <FormGrid cols={3}>
        <Select label="Called" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={readOnly} options={[...ITEM_CODE_PRESETS.map((p) => ({ value: p.itemCode, label: p.itemCode })), { value: CUSTOM, label: "Something else…" }]} />
        {choice === CUSTOM && (
          <>
            <TextField label="Your word" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Stock code" disabled={readOnly} />
            <TextField label="Short form" hint="(optional)" value={short} onChange={(e) => setShort(e.target.value)} placeholder={next.itemCodeShort} disabled={readOnly} help="For narrow columns" />
          </>
        )}
      </FormGrid>
      <p className="text-[12px] text-text-tertiary">
        Column header: <span className="font-medium text-text-secondary">{next.itemCodeShort}</span> · Field label: <span className="font-medium text-text-secondary">{next.itemCode}</span> · Plural: <span className="font-medium text-text-secondary">{next.itemCodes}</span>
      </p>
    </SettingsCard>
  );
}
