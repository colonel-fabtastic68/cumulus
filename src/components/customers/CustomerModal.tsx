"use client";

import { useState } from "react";
import type { Address, Contact, Customer } from "@/lib/types";
import { Banner, Button, FormGrid, Modal, Select, TextArea, TextField, Toggle, useToast } from "@/components/ui";
import { useCurrentUser } from "@/lib/auth";
import { saveCustomer } from "@/lib/customers";
import { useSettings, useStore } from "@/lib/store/provider";
import { customFieldsFor, priceGroups } from "@/lib/catalog";
import { ContactsEditor, CustomFieldsEditor } from "@/components/fields";

const emptyAddress = (): Address => ({ street1: "", city: "", state: "", zip: "", country: "US" });

export function CustomerModal({ open, customer, onClose, onSaved }: { open: boolean; customer?: Customer | null; onClose: () => void; onSaved?: (c: Customer) => void }) {
  if (!open) return null;
  return <Form key={customer?.id ?? "new"} customer={customer} onClose={onClose} onSaved={onSaved} />;
}

function Form({ customer, onClose, onSaved }: { customer?: Customer | null; onClose: () => void; onSaved?: (c: Customer) => void }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const [name, setName] = useState(customer?.name ?? "");
  const [email, setEmail] = useState(customer?.email ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [company, setCompany] = useState(customer?.company ?? "");
  const [address, setAddress] = useState<Address>(customer?.address ?? emptyAddress());
  const [tags, setTags] = useState((customer?.tags ?? []).join(", "));
  const [notes, setNotes] = useState(customer?.notes ?? "");
  const settings = useSettings();
  const groups = priceGroups(settings);
  const fieldDefs = customFieldsFor(settings, "customers");
  const [contacts, setContacts] = useState<Contact[]>(customer?.contacts?.map((c) => ({ ...c })) ?? []);
  const [priceGroupId, setPriceGroupId] = useState(customer?.priceGroupId ?? "");
  const [discountPct, setDiscountPct] = useState(customer?.discountPct !== undefined ? String(customer.discountPct) : "");
  const [taxExempt, setTaxExempt] = useState(customer?.taxExempt === true);
  const [attributes, setAttributes] = useState<Record<string, string>>({ ...(customer?.attributes ?? {}) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setA = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => setAddress((a) => ({ ...a, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await saveCustomer(store, user, { name, email, phone, company, address, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), notes, contacts, priceGroupId: priceGroupId || undefined, discountPct: discountPct.trim() ? Number(discountPct) : undefined, taxExempt, attributes }, customer?.id);
      toast(customer ? `Updated ${saved.name}` : `Added ${saved.name}`, "success");
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={customer ? customer.name : "New customer"}
      subtitle={customer ? "Orders, returns and quotes for this customer link here." : "A person or business you sell to. Orders and returns will point at this record."}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} loading={busy} disabled={!name.trim()}>
            {customer ? "Save changes" : "Add customer"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormGrid cols={2}>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Maya Okafor" autoFocus />
          <TextField label="Company" hint="(optional)" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Sweetwater" />
          <TextField label="Email" hint="(optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="maya@example.com" />
          <TextField label="Phone" hint="(optional)" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </FormGrid>
        <div className="rounded-[var(--radius)] border border-border p-3">
          <div className="mb-2 text-[12.5px] font-medium text-text">Address <span className="font-normal text-text-tertiary">(optional)</span></div>
          <FormGrid cols={2}>
            <TextField label="Street" value={address.street1} onChange={setA("street1")} />
            <TextField label="Street 2" value={address.street2 ?? ""} onChange={setA("street2")} />
            <TextField label="City" value={address.city} onChange={setA("city")} />
            <TextField label="State" value={address.state ?? ""} onChange={setA("state")} />
            <TextField label="ZIP" value={address.zip} onChange={setA("zip")} />
            <TextField label="Country" value={address.country} onChange={setA("country")} placeholder="US" />
          </FormGrid>
        </div>
        <ContactsEditor contacts={contacts} onChange={setContacts} />
        <FormGrid cols={3}>
          <Select label="Price group" value={priceGroupId} onChange={(e) => setPriceGroupId(e.target.value)} options={[{ value: "", label: groups.length ? "List price" : "None defined (Settings → Catalog)" }, ...groups.map((g) => ({ value: g.id, label: g.name }))]} help="Items priced for this group use that price on orders." />
          <TextField label="Discount %" hint="(optional)" type="number" min={0} max={100} step="any" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} help="Off every line, after the group price." />
          <div className="flex items-end pb-1">
            <Toggle label="Tax exempt" help="No sales tax on orders." checked={taxExempt} onChange={setTaxExempt} size="sm" />
          </div>
        </FormGrid>
        <CustomFieldsEditor defs={fieldDefs} values={attributes} onChange={setAttributes} />
        <TextField label="Tags" hint="(comma separated)" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="wholesale, priority" />
        <TextArea label="Notes" hint="(optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Delivery preferences, contacts, terms." />
        {error && <Banner tone="critical">{error}</Banner>}
      </div>
    </Modal>
  );
}
