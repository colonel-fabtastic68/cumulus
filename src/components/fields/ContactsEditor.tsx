"use client";

import { Plus, Trash2 } from "lucide-react";
import type { Contact } from "@/lib/types";
import { Button, TextField } from "@/components/ui";

/** Primary and further contacts for a customer or supplier. The first row is the primary. */
export function ContactsEditor({ contacts, onChange, disabled }: { contacts: Contact[]; onChange: (next: Contact[]) => void; disabled?: boolean }) {
  const update = (i: number, patch: Partial<Contact>) => onChange(contacts.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[12.5px] font-medium text-text">Contacts</span>
        {!disabled && (
          <Button size="sm" variant="plain" icon={<Plus />} onClick={() => onChange([...contacts, { name: "" }])}>
            {contacts.length ? "Add another contact" : "Add contact"}
          </Button>
        )}
      </div>
      {contacts.length === 0 && <p className="text-[12.5px] text-text-tertiary">Who to talk to: a buyer, an accounts payable contact, a second warehouse number.</p>}
      {contacts.map((c, i) => (
        <div key={i} className="grid grid-cols-1 gap-2 rounded-[var(--radius)] border border-border p-2.5 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end">
          <TextField label={i === 0 ? "Primary contact" : `Contact ${i + 1}`} value={c.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Dana Ruiz" disabled={disabled} />
          <TextField label="Role" hint="(optional)" value={c.role ?? ""} onChange={(e) => update(i, { role: e.target.value })} placeholder="Purchasing" disabled={disabled} />
          <TextField label="Email" type="email" value={c.email ?? ""} onChange={(e) => update(i, { email: e.target.value })} disabled={disabled} />
          <TextField label="Phone" type="tel" value={c.phone ?? ""} onChange={(e) => update(i, { phone: e.target.value })} disabled={disabled} />
          {!disabled && <Button size="md" variant="plain" icon={<Trash2 />} aria-label="Remove contact" onClick={() => onChange(contacts.filter((_, j) => j !== i))} className="sm:mb-0.5" />}
        </div>
      ))}
    </div>
  );
}
