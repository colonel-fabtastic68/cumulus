"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Supplier } from "@/lib/types";
import { useCollection } from "@/lib/store/provider";
import { useFeature } from "@/lib/useFeature";
import { Combobox, Select } from "@/components/ui";
import { NewSupplierModal } from "./NewSupplierModal";

/** Suppliers in A to Z order, ignoring case. */
export function sortSuppliers(suppliers: readonly Supplier[]): Supplier[] {
  return [...suppliers].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

interface SupplierPickerProps {
  /** The chosen supplier's id, or "" for none. */
  value: string;
  onChange: (supplierId: string) => void;
  /** Which suppliers to offer; every supplier when left out. */
  suppliers?: readonly Supplier[];
  label?: ReactNode;
  help?: ReactNode;
  /** Shown for "" (e.g. "None", "Leave unchanged"); without it there is no empty choice. */
  emptyLabel?: string;
}

/**
 * Pick a supplier. With `supplierPicker` on, the list is A to Z and typing a name that is not
 * there opens the new-supplier form with that name filled in; the new supplier is then chosen.
 */
export function SupplierPicker({ value, onChange, suppliers, label = "Supplier", help, emptyLabel }: SupplierPickerProps) {
  const enabled = useFeature("supplierPicker");
  const all = useCollection("suppliers");
  const offered = suppliers ?? all;
  const [creating, setCreating] = useState<string | null>(null);

  const options = useMemo(() => {
    const list = (enabled ? sortSuppliers(offered) : offered).map((s) => ({ value: s.id, label: s.name }));
    return emptyLabel && enabled ? [{ value: "", label: emptyLabel }, ...list] : list;
  }, [offered, enabled, emptyLabel]);

  if (!enabled) {
    return <Select label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={emptyLabel} options={options} help={help} />;
  }

  return (
    <div>
      <Combobox label={label} value={value} onChange={onChange} options={options} placeholder={emptyLabel ?? "Type a supplier name"} onCreate={setCreating} createLabel={(q) => `Add “${q}” as a new supplier`} />
      {help && <p className="mt-1 text-[12px] text-text-tertiary">{help}</p>}
      <NewSupplierModal open={creating !== null} initialName={creating ?? ""} onClose={() => setCreating(null)} onCreated={(s) => onChange(s.id)} />
    </div>
  );
}
