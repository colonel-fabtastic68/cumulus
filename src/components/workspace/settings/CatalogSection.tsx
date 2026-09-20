"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { CustomFieldDef, WorkspaceSettings } from "@/lib/types";
import { emptyCatalog, keyFromLabel } from "@/lib/catalog";
import { Button, Select, TextField, useToast } from "@/components/ui";
import { newId } from "@/lib/utils";
import { useSaveSettings } from "./useSaveSettings";

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Choice list" },
];

/** Item types beyond part/assembly, customer price groups, and custom fields for items, customers and suppliers. */
export function CatalogSection({ settings, readOnly }: { settings: WorkspaceSettings; readOnly: boolean }) {
  const saveSettings = useSaveSettings();
  const toast = useToast();
  const initial = { ...emptyCatalog(), ...(settings.catalog ?? {}), customFields: { ...emptyCatalog().customFields, ...(settings.catalog?.customFields ?? {}) } };
  const [itemTypes, setItemTypes] = useState(initial.itemTypes.map((t) => ({ ...t })));
  const [groups, setGroups] = useState(initial.priceGroups.map((g) => ({ ...g })));
  const [fields, setFields] = useState<Record<"items" | "customers" | "suppliers", CustomFieldDef[]>>({
    items: (initial.customFields.items ?? []).map((f) => ({ ...f })),
    customers: (initial.customFields.customers ?? []).map((f) => ({ ...f })),
    suppliers: (initial.customFields.suppliers ?? []).map((f) => ({ ...f })),
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const clean = (list: CustomFieldDef[]) => list.filter((f) => f.label.trim()).map((f) => ({ ...f, key: f.key || keyFromLabel(f.label), label: f.label.trim(), options: f.type === "select" ? (f.options ?? []).map((o) => o.trim()).filter(Boolean) : undefined }));
      await saveSettings({
        catalog: {
          itemTypes: itemTypes.filter((t) => t.label.trim()).map((t) => ({ id: t.id, label: t.label.trim() })),
          priceGroups: groups.filter((g) => g.name.trim()).map((g) => ({ id: g.id, name: g.name.trim(), kind: g.kind ?? "percent", value: g.value && g.value > 0 ? g.value : undefined })),
          customFields: { items: clean(fields.items), customers: clean(fields.customers), suppliers: clean(fields.suppliers) },
        },
      });
      toast("Catalog settings saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "critical");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Block title="Item types" hint="Part and Assembly are built in (assemblies carry a BOM). Add your own groupings: kit, consumable, service, raw material.">
        {itemTypes.map((t, i) => (
          <div key={t.id} className="flex items-end gap-2">
            <TextField value={t.label} onChange={(e) => setItemTypes((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder="Kit" containerClassName="flex-1" disabled={readOnly} />
            {!readOnly && <Button size="md" variant="plain" icon={<Trash2 />} aria-label="Remove type" onClick={() => setItemTypes((l) => l.filter((_, j) => j !== i))} />}
          </div>
        ))}
        {!readOnly && (
          <Button size="sm" variant="plain" icon={<Plus />} onClick={() => setItemTypes((l) => [...l, { id: newId("typ"), label: "" }])}>
            Add item type
          </Button>
        )}
      </Block>

      <Block title="Customer price groups" hint="Named tiers (non-stocking dealer, stocking dealer, distributor, OEM, international…), each a percentage or a fixed amount off list price. Assign customers to a group on the Customers page; volume breaks still apply first.">
        {groups.map((g, i) => (
          <div key={g.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_120px_auto] sm:items-end">
            <TextField label={i === 0 ? "Group" : undefined} value={g.name} onChange={(e) => setGroups((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Stocking dealer" disabled={readOnly} />
            <Select label={i === 0 ? "Discount" : undefined} value={g.kind ?? "percent"} onChange={(e) => setGroups((l) => l.map((x, j) => (j === i ? { ...x, kind: e.target.value as "percent" | "amount" } : x)))} options={[{ value: "percent", label: "% off" }, { value: "amount", label: `${settings.currency} off per unit` }]} disabled={readOnly} />
            <TextField label={i === 0 ? "Value" : undefined} type="number" min={0} step="any" value={g.value !== undefined ? String(g.value) : ""} onChange={(e) => setGroups((l) => l.map((x, j) => (j === i ? { ...x, value: e.target.value === "" ? undefined : Number(e.target.value) } : x)))} placeholder={g.kind === "amount" ? "5.00" : "15"} disabled={readOnly} />
            {!readOnly && <Button size="md" variant="plain" icon={<Trash2 />} aria-label="Remove group" onClick={() => setGroups((l) => l.filter((_, j) => j !== i))} className="sm:mb-0.5" />}
          </div>
        ))}
        {!readOnly && (
          <Button size="sm" variant="plain" icon={<Plus />} onClick={() => setGroups((l) => [...l, { id: newId("pg"), name: "" }])}>
            Add price group
          </Button>
        )}
      </Block>

      {(["items", "customers", "suppliers"] as const).map((kind) => (
        <Block key={kind} title={`Custom fields · ${kind}`} hint={kind === "items" ? "Searchable extra attributes: wheel diameter, width, backspace, finish. They appear on the item form and as inventory columns." : kind === "customers" ? "Extra details per customer: resale certificate number, territory, account manager." : "Extra details per supplier: account number, MOQ, vendor code."}>
          {fields[kind].map((f, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 rounded-[var(--radius)] border border-border p-2.5 sm:grid-cols-[1fr_150px_1fr_auto] sm:items-end">
              <TextField label="Label" value={f.label} onChange={(e) => setFields((all) => ({ ...all, [kind]: all[kind].map((x, j) => (j === i ? { ...x, label: e.target.value, key: x.key || keyFromLabel(e.target.value) } : x)) }))} placeholder="Wheel diameter" disabled={readOnly} />
              <Select label="Type" value={f.type} onChange={(e) => setFields((all) => ({ ...all, [kind]: all[kind].map((x, j) => (j === i ? { ...x, type: e.target.value as CustomFieldDef["type"] } : x)) }))} options={FIELD_TYPES} disabled={readOnly} />
              {f.type === "select" ? (
                <TextField label="Choices" hint="(comma separated)" value={(f.options ?? []).join(", ")} onChange={(e) => setFields((all) => ({ ...all, [kind]: all[kind].map((x, j) => (j === i ? { ...x, options: e.target.value.split(",").map((o) => o.trimStart()) } : x)) }))} placeholder="Gloss, Matte, Chrome" disabled={readOnly} />
              ) : (
                <div className="text-[12px] text-text-tertiary sm:pb-2.5">
                  key <span className="font-mono">{f.key || keyFromLabel(f.label)}</span>
                </div>
              )}
              {!readOnly && <Button size="md" variant="plain" icon={<Trash2 />} aria-label="Remove field" onClick={() => setFields((all) => ({ ...all, [kind]: all[kind].filter((_, j) => j !== i) }))} className="sm:mb-0.5" />}
            </div>
          ))}
          {!readOnly && (
            <Button size="sm" variant="plain" icon={<Plus />} onClick={() => setFields((all) => ({ ...all, [kind]: [...all[kind], { key: "", label: "", type: "text" }] }))}>
              Add field
            </Button>
          )}
        </Block>
      ))}

      {!readOnly && (
        <div>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            Save catalog settings
          </Button>
        </div>
      )}
    </div>
  );
}

function Block({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div>
        <h3 className="text-[13px] font-semibold text-text">{title}</h3>
        <p className="text-[12.5px] text-text-secondary">{hint}</p>
      </div>
      {children}
    </div>
  );
}
