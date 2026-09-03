"use client";

import { useId } from "react";
import { FormGrid, TextArea, TextField } from "@/components/ui";
import { TERMS_SUGGESTIONS, type SupplierDraft } from "./supplierUtils";

interface SupplierFieldsProps {
  draft: SupplierDraft;
  onChange: (patch: Partial<SupplierDraft>) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

/** The supplier form body, shared by the create modal and the edit drawer. */
export function SupplierFields({ draft, onChange, disabled, autoFocus }: SupplierFieldsProps) {
  const termsListId = useId();
  return (
    <div className="flex flex-col gap-3">
      <TextField label="Name" value={draft.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Mouser Electronics" autoFocus={autoFocus} disabled={disabled} />
      <FormGrid cols={2}>
        <TextField label="Email" type="email" inputMode="email" autoComplete="off" value={draft.email} onChange={(e) => onChange({ email: e.target.value })} placeholder="orders@supplier.com" disabled={disabled} />
        <TextField label="Phone" type="tel" inputMode="tel" autoComplete="off" value={draft.phone} onChange={(e) => onChange({ phone: e.target.value })} placeholder="+1 (800) 346-6873" disabled={disabled} />
        <TextField label="Website" inputMode="url" autoComplete="off" value={draft.website} onChange={(e) => onChange({ website: e.target.value })} placeholder="https://" disabled={disabled} />
        <TextField
          label="Lead time"
          type="number"
          min={0}
          step={1}
          value={draft.leadTimeDays}
          onChange={(e) => onChange({ leadTimeDays: e.target.value })}
          suffix="days"
          help="Used for items without their own lead time"
          disabled={disabled}
        />
        <div>
          <TextField label="Terms" value={draft.terms} onChange={(e) => onChange({ terms: e.target.value })} placeholder="Net 30" list={termsListId} autoComplete="off" disabled={disabled} />
          <datalist id={termsListId}>
            {TERMS_SUGGESTIONS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
      </FormGrid>
      <TextArea label="Notes" hint="(optional)" value={draft.notes} onChange={(e) => onChange({ notes: e.target.value })} rows={3} placeholder="Minimum order $50. Ask for Dana in sales for volume pricing." disabled={disabled} />
    </div>
  );
}
