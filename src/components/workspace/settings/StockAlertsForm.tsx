"use client";

import type { StockAlertRule } from "@/lib/types";
import { FormGrid, Select, TextField } from "@/components/ui";

const MODES = [
  { value: "min", label: "Below the item's own min" },
  { value: "quantity", label: "Below a fixed quantity" },
  { value: "percentOfMax", label: "Below a % of the item's max" },
];

/** The low-stock rule: what "Low" means, and an optional earlier amber warning. Shared by Settings and the Inventory popup. */
export function StockAlertsForm({ value, onChange, disabled }: { value: StockAlertRule; onChange: (next: StockAlertRule) => void; disabled?: boolean }) {
  return (
    <FormGrid cols={3}>
      <Select label="Low stock means" value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as StockAlertRule["mode"] })} options={MODES} disabled={disabled} />
      {value.mode === "quantity" && <TextField label="Quantity" type="number" min={0} step="any" value={value.value ?? ""} onChange={(e) => onChange({ ...value, value: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="10" help="Every item is low below this many units." disabled={disabled} />}
      {value.mode === "percentOfMax" && <TextField label="% of max" type="number" min={0} max={100} step="any" value={value.value ?? ""} onChange={(e) => onChange({ ...value, value: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="25" help="Items without a max fall back to their min." disabled={disabled} />}
      <TextField label="Warn early" hint="(optional)" type="number" min={0} max={500} step="any" value={value.warnPct ?? ""} onChange={(e) => onChange({ ...value, warnPct: e.target.value === "" ? undefined : Number(e.target.value) })} suffix="% above low" help="Amber when stock is within this margin above the low line." disabled={disabled} />
    </FormGrid>
  );
}
