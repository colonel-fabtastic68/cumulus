"use client";

import type { CustomFieldDef } from "@/lib/types";
import { FormGrid, Select, TextField } from "@/components/ui";

/** Inputs for the custom fields a workspace defined for this kind of record (Settings → Catalog). */
export function CustomFieldsEditor({ defs, values, onChange, disabled }: { defs: CustomFieldDef[]; values: Record<string, string>; onChange: (next: Record<string, string>) => void; disabled?: boolean }) {
  if (defs.length === 0) return null;
  const set = (key: string, v: string) => onChange({ ...values, [key]: v });
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12.5px] font-medium text-text">Custom fields</span>
      <FormGrid cols={2}>
        {defs.map((d) =>
          d.type === "select" ? (
            <Select key={d.key} label={d.label} value={values[d.key] ?? ""} onChange={(e) => set(d.key, e.target.value)} options={[{ value: "", label: "—" }, ...(d.options ?? []).map((o) => ({ value: o, label: o }))]} disabled={disabled} />
          ) : (
            <TextField key={d.key} label={d.label} type={d.type === "number" ? "number" : d.type === "date" ? "date" : "text"} step={d.type === "number" ? "any" : undefined} value={values[d.key] ?? ""} onChange={(e) => set(d.key, e.target.value)} disabled={disabled} />
          ),
        )}
      </FormGrid>
    </div>
  );
}
