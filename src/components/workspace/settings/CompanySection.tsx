"use client";

import { useMemo, useState } from "react";
import type { WorkspaceSettings } from "@/lib/types";
import { Button, FormGrid, Select, TextField, useToast } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { SettingsCard } from "./SettingsCard";
import { useSaveSettings } from "./useSaveSettings";

export const CURRENCIES: Array<{ value: string; label: string }> = [
  { value: "USD", label: "USD — US dollar" },
  { value: "EUR", label: "EUR — Euro" },
  { value: "GBP", label: "GBP — British pound" },
  { value: "CAD", label: "CAD — Canadian dollar" },
  { value: "AUD", label: "AUD — Australian dollar" },
  { value: "NZD", label: "NZD — New Zealand dollar" },
  { value: "MXN", label: "MXN — Mexican peso" },
];

/**
 * Company name, currency and timezone. Remount (via key) when the saved
 * settings change so the form always starts from what is stored.
 */
export function CompanySection({ settings, readOnly }: { settings: WorkspaceSettings; readOnly: boolean }) {
  const saveSettings = useSaveSettings();
  const toast = useToast();
  const [companyName, setCompanyName] = useState(settings.companyName);
  const [currency, setCurrency] = useState(settings.currency);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [saving, setSaving] = useState(false);

  const options = useMemo(() => (CURRENCIES.some((c) => c.value === settings.currency) ? CURRENCIES : [{ value: settings.currency, label: settings.currency }, ...CURRENCIES]), [settings.currency]);

  const nameError = companyName.trim() ? undefined : "Enter a company name";
  const dirty = companyName.trim() !== settings.companyName || currency !== settings.currency || timezone.trim() !== settings.timezone;

  const save = async () => {
    if (nameError) return;
    setSaving(true);
    try {
      await saveSettings({ companyName: companyName.trim(), currency, timezone: timezone.trim() || "UTC" });
      toast("Company settings saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save settings", "critical");
    } finally {
      setSaving(false);
    }
  };

  const useBrowserTimezone = () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz) setTimezone(tz);
    } catch {
      toast("Could not read the browser timezone", "critical");
    }
  };

  return (
    <SettingsCard onSave={() => void save()} saving={saving} dirty={dirty && !nameError} readOnly={readOnly} footerNote={dirty ? "Unsaved changes" : undefined}>
      <TextField label="Company name" value={companyName} onChange={(e) => setCompanyName(e.target.value)} error={nameError} help="Shown in the sidebar and on exports." disabled={readOnly} />
      <FormGrid cols={2}>
        <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)} options={options} help={`Money shows as ${formatMoney(1234.5, currency)}.`} disabled={readOnly} />
        <TextField
          label="Timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="America/Chicago"
          help={
            <span className="inline-flex flex-wrap items-center gap-x-1">
              IANA name, used for daily digests.
              {!readOnly && (
                <Button variant="plain" size="sm" className="h-auto px-1 py-0 text-[12px]" onClick={useBrowserTimezone}>
                  Use browser timezone
                </Button>
              )}
            </span>
          }
          disabled={readOnly}
        />
      </FormGrid>
    </SettingsCard>
  );
}
