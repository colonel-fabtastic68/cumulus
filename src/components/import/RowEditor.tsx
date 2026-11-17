"use client";

import { useState } from "react";
import { Trash2, Undo2 } from "lucide-react";
import { Badge, Banner, Button, Combobox, FormGrid, IconButton, Select, SimpleTable, TextField, type ComboboxOption } from "@/components/ui";
import type { ImportBomLine } from "@/lib/importBoms";
import { mergeBomLines } from "@/lib/importBoms";
import type { ImportRow } from "@/lib/inventory";
import { cn } from "@/lib/utils";
import { parseLenientNumber } from "./convert";
import type { ReviewRow, RowEdit } from "./types";

const TEXT = ["sku", "name", "category", "unit", "location", "supplierName"] as const;
const NUMBERS = ["qty", "unitCost", "price"] as const;
type TextKey = (typeof TEXT)[number];
type NumberKey = (typeof NUMBERS)[number];

interface DraftLine {
  sku: string;
  qty: string;
}

export interface RowEditorProps {
  /** The row as it stands, with any earlier edits applied. */
  row: ReviewRow;
  /** The same row from the file (and Strato's fills) without edits: what an edit is measured against. */
  base: ImportRow;
  /** An existing assembly's parts list, by SKU, shown when the file does not set one. */
  existingBom: ImportBomLine[];
  /** Everything a component can be: this file's rows and the items already in inventory. */
  candidates: ComboboxOption[];
  /** A row added on the review step rather than read from the file. */
  isNew?: boolean;
  onSave: (edit: RowEdit | null) => void;
  /** Leave this row out of the import. */
  onRemove: () => void;
  onClose: () => void;
}

const str = (v: string | number | undefined) => (v === undefined ? "" : String(v));

/**
 * The form inside the review step's drawer: the row's main fields, part or assembly, and an assembly's parts list.
 * Mount it only while the drawer is open so it starts from the row each time.
 */
export function RowEditor({ row, base, existingBom, candidates, isNew, onSave, onRemove, onClose }: RowEditorProps) {
  const current = row.row;
  const baseType = base.type ?? row.existing?.type ?? "part";
  const baseBom = base.bom ?? existingBom;

  const [text, setText] = useState<Record<TextKey, string>>(() => Object.fromEntries(TEXT.map((k) => [k, str(current[k])])) as Record<TextKey, string>);
  const [nums, setNums] = useState<Record<NumberKey, string>>(() => Object.fromEntries(NUMBERS.map((k) => [k, str(current[k])])) as Record<NumberKey, string>);
  const [type, setType] = useState<"part" | "assembly">(() => ((current.type ?? row.existing?.type) === "assembly" ? "assembly" : "part"));
  const [lines, setLines] = useState<DraftLine[]>(() => (current.bom ?? existingBom).map((l) => ({ sku: l.sku, qty: String(l.qty) })));

  const selfSku = text.sku.trim().toUpperCase();
  const used = new Set(lines.map((l) => l.sku));
  const labelOf = new Map(candidates.map((c) => [c.value, c.label]));
  const addOptions = candidates.filter((c) => c.value !== selfSku && !used.has(c.value));

  const numberErrors = Object.fromEntries(NUMBERS.map((k) => [k, parseLenientNumber(nums[k]).error])) as Record<NumberKey, string | undefined>;
  const badLines = lines.filter((l) => !(Number(l.qty) > 0));
  const invalid = Object.values(numberErrors).some(Boolean) || (type === "assembly" && badLines.length > 0);

  const save = () => {
    if (invalid) return;
    const edit: RowEdit = {};
    for (const k of TEXT) {
      const v = text[k].trim();
      if (v !== str(base[k]).trim()) edit[k] = v === "" ? null : v;
    }
    for (const k of NUMBERS) {
      const v = parseLenientNumber(nums[k]).value;
      if (v !== base[k]) edit[k] = v === undefined ? null : v;
    }
    if (type !== baseType) edit.type = type;
    if (type === "assembly") {
      const next = mergeBomLines(lines.map((l) => ({ sku: l.sku, qty: Number(l.qty) })));
      const same = JSON.stringify(next) === JSON.stringify(mergeBomLines(baseBom));
      if (!same) edit.bom = next.length ? next : null;
    }
    onSave(Object.keys(edit).length ? edit : null);
  };

  return (
    <div className="flex flex-col gap-5">
      {row.message && !(isNew && !row.edited) && (
        <Banner tone="critical" title="This row has a problem">
          {row.message}
        </Banner>
      )}

      <FormGrid cols={2}>
        <TextField label="SKU" value={text.sku} onChange={(e) => setText((t) => ({ ...t, sku: e.target.value }))} className="font-mono" />
        <TextField label="Name" value={text.name} onChange={(e) => setText((t) => ({ ...t, name: e.target.value }))} />
        <Select
          label="Part or assembly"
          value={type}
          onChange={(e) => setType(e.target.value === "assembly" ? "assembly" : "part")}
          options={[
            { value: "part", label: "Part" },
            { value: "assembly", label: "Assembly (has a parts list)" },
          ]}
        />
        <TextField label="Category" value={text.category} onChange={(e) => setText((t) => ({ ...t, category: e.target.value }))} />
        <TextField label="Unit of measure" value={text.unit} onChange={(e) => setText((t) => ({ ...t, unit: e.target.value }))} placeholder="ea" />
        <TextField label="On-hand quantity" value={nums.qty} onChange={(e) => setNums((n) => ({ ...n, qty: e.target.value }))} error={numberErrors.qty} inputMode="decimal" />
        <TextField label="Unit cost" value={nums.unitCost} onChange={(e) => setNums((n) => ({ ...n, unitCost: e.target.value }))} error={numberErrors.unitCost} inputMode="decimal" />
        <TextField label="Price" value={nums.price} onChange={(e) => setNums((n) => ({ ...n, price: e.target.value }))} error={numberErrors.price} inputMode="decimal" />
        <TextField label="Location / bin" value={text.location} onChange={(e) => setText((t) => ({ ...t, location: e.target.value }))} />
        <TextField label="Supplier" value={text.supplierName} onChange={(e) => setText((t) => ({ ...t, supplierName: e.target.value }))} />
      </FormGrid>

      {type === "assembly" && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h4 className="text-[12px] font-semibold text-text-secondary">Parts list</h4>
            <span className="text-[12px] text-text-tertiary">{lines.length === 1 ? "1 component" : `${lines.length} components`}</span>
          </div>
          <SimpleTable>
            <thead>
              <tr>
                <th>Component</th>
                <th className="w-28 text-right">Qty per</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-5 text-center text-text-tertiary">
                    No components yet. Add the parts this assembly is built from.
                  </td>
                </tr>
              )}
              {lines.map((l, idx) => {
                const bad = !(Number(l.qty) > 0);
                return (
                  <tr key={l.sku}>
                    <td>
                      <span className="text-[12.5px] text-text">{labelOf.get(l.sku) ?? l.sku}</span>
                      {!labelOf.has(l.sku) && <Badge tone="critical" className="ml-2">Not found</Badge>}
                    </td>
                    <td className="text-right">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={l.qty}
                        onChange={(e) => setLines((ls) => ls.map((x, i) => (i === idx ? { ...x, qty: e.target.value } : x)))}
                        aria-label={`Quantity of ${l.sku}`}
                        className={cn("h-7 w-24 rounded-[var(--radius-sm)] border bg-surface px-2 text-right text-[13px] tabular outline-none focus:border-accent focus:ring-2 focus:ring-accent/20", bad ? "border-critical" : "border-border-strong/70")}
                      />
                    </td>
                    <td className="text-right">
                      <IconButton variant="plain" size="sm" onClick={() => setLines((ls) => ls.filter((_, i) => i !== idx))} className="text-text-tertiary hover:text-critical" aria-label={`Remove ${l.sku}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </SimpleTable>
          <Combobox
            className="mt-2"
            value=""
            onChange={(sku) => sku && setLines((ls) => [...ls, { sku, qty: "1" }])}
            options={addOptions}
            placeholder="Add a component by SKU or name"
            aria-label="Add a component"
          />
          <p className="mt-1.5 text-[12px] text-text-tertiary">Pick from the rows in this file or the items already in inventory. Components new in this file are created first, then linked.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-1">
          {!(isNew && !row.edited) && (
            <Button variant="plain" icon={<Trash2 />} onClick={onRemove} className="text-critical">
              Remove from import
            </Button>
          )}
          {row.edited && !isNew && (
            <Button variant="plain" icon={<Undo2 />} onClick={() => onSave(null)}>
              Use the file&apos;s values
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={invalid}>
            {isNew && !row.edited ? "Add part" : "Save row"}
          </Button>
        </div>
      </div>
    </div>
  );
}
