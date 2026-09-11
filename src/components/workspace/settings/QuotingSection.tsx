"use client";

import { useState } from "react";
import type { WorkspaceSettings } from "@/lib/types";
import { DEFAULT_QUOTING } from "@/lib/quotes";
import { Button, FormGrid, TextArea, TextField, useToast } from "@/components/ui";
import { useSaveSettings } from "./useSaveSettings";

/** Labour rate, margins and terms that every quote starts from. */
export function QuotingSection({ settings, readOnly }: { settings: WorkspaceSettings; readOnly: boolean }) {
  const saveSettings = useSaveSettings();
  const toast = useToast();
  const q = { ...DEFAULT_QUOTING, ...(settings.quoting ?? {}) };
  const [laborRate, setLaborRate] = useState(String(q.laborRate || ""));
  const [laborCost, setLaborCost] = useState(q.laborCost === undefined ? "" : String(q.laborCost));
  const [marginPct, setMarginPct] = useState(q.defaultMarginPct === undefined ? "" : String(q.defaultMarginPct));
  const [taxPct, setTaxPct] = useState(q.taxPct === undefined ? "" : String(q.taxPct));
  const [validDays, setValidDays] = useState(String(q.validDays));
  const [terms, setTerms] = useState(q.terms ?? "");
  const [saving, setSaving] = useState(false);
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

  const save = async () => {
    setSaving(true);
    try {
      await saveSettings({ quoting: { laborRate: num(laborRate) ?? 0, laborCost: num(laborCost), defaultMarginPct: num(marginPct), taxPct: num(taxPct), validDays: Math.max(1, num(validDays) ?? 30), terms: terms.trim() || undefined } });
      toast("Quoting settings saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "critical");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <FormGrid cols={3}>
        <TextField label={`Labour rate (${settings.currency}/h)`} type="number" min={0} step="any" value={laborRate} onChange={(e) => setLaborRate(e.target.value)} help="What an hour is charged at on quotes." disabled={readOnly} />
        <TextField label={`Labour cost (${settings.currency}/h)`} hint="(optional)" type="number" min={0} step="any" value={laborCost} onChange={(e) => setLaborCost(e.target.value)} help="What an hour costs you, for margin." disabled={readOnly} />
        <TextField label="Default margin %" hint="(optional)" type="number" min={0} max={99} step="any" value={marginPct} onChange={(e) => setMarginPct(e.target.value)} help="Used to price items that have no list price." disabled={readOnly} />
        <TextField label="Tax %" hint="(optional)" type="number" min={0} step="any" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} disabled={readOnly} />
        <TextField label="Quotes valid for (days)" type="number" min={1} value={validDays} onChange={(e) => setValidDays(e.target.value)} disabled={readOnly} />
      </FormGrid>
      <TextArea label="Standard terms" hint="(optional)" rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Prices exclude shipping. 50% deposit on acceptance." disabled={readOnly} />
      {!readOnly && (
        <div>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            Save quoting settings
          </Button>
        </div>
      )}
    </div>
  );
}
