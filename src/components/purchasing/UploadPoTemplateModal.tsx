"use client";

import { useMemo, useRef, useState } from "react";
import { FileUp } from "lucide-react";
import type { PurchaseOrderTemplate } from "@/lib/types";
import { upsertSupplier } from "@/lib/inventory";
import { detectTemplateColumns, savePurchaseOrderTemplate, templateFromRows } from "@/lib/purchaseOrders";
import { useCollection, useItems, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { parseFile, parsePasted } from "@/components/import/parse";
import type { ParsedSource } from "@/components/import/types";
import { pluralize } from "@/lib/format";
import { Banner, Button, Combobox, FormGrid, Modal, Select, TextArea, TextField, useToast } from "@/components/ui";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with the saved template; `useNow` when the person wants an order from it straight away. */
  onSaved?: (template: PurchaseOrderTemplate, useNow: boolean) => void;
}

export function UploadPoTemplateModal(props: Props) {
  if (!props.open) return null;
  return <UploadForm {...props} />;
}

type Field = "sku" | "qty" | "unitCost" | "note" | "supplier";
const FIELD_LABEL: Record<Field, string> = { sku: "SKU / part number", qty: "Quantity", unitCost: "Unit cost", note: "Line note", supplier: "Supplier" };

function UploadForm({ open, onClose, onSaved }: Props) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const items = useItems();
  const suppliers = useCollection("suppliers");
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<ParsedSource | null>(null);
  const [pasted, setPasted] = useState("");
  const [columns, setColumns] = useState<Partial<Record<Field, string>>>({});
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [supplier, setSupplier] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = (parsed: ParsedSource) => {
    setSource(parsed);
    const detected = detectTemplateColumns(parsed.headers);
    setColumns(detected);
    if (!name) setName(parsed.name.replace(/\.[a-z]+$/i, ""));
    const preview = templateFromRows(parsed.headers, parsed.rows, items, detected);
    if (preview.supplierName && !supplier) setSupplier(preview.supplierName);
    setError(parsed.rows.length ? null : "The file has no rows");
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      load(await parseFile(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the file");
    }
  };

  const result = useMemo(() => (source ? templateFromRows(source.headers, source.rows, items, columns) : null), [source, items, columns]);
  const supplierOptions = useMemo(() => [...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ value: s.name, label: s.name })), [suppliers]);
  const headerOptions = source ? [{ value: "", label: "Not in the file" }, ...source.headers.map((h) => ({ value: h, label: h }))] : [];

  const save = async (useNow: boolean) => {
    if (!result || result.lines.length === 0) return setError("No rows matched an item. Check the SKU and quantity columns.");
    if (!name.trim()) return setError("Give the template a name");
    setBusy(true);
    setError(null);
    try {
      let supplierId = suppliers.find((s) => s.name.toLowerCase() === supplier.trim().toLowerCase())?.id;
      if (!supplierId && supplier.trim()) supplierId = (await upsertSupplier(store, user, { name: supplier.trim() })).id;
      const t = await savePurchaseOrderTemplate(store, user, { name, description, supplierId, supplier: supplier.trim(), lines: result.lines, source: "upload" });
      toast(`Saved template “${t.name}” with ${pluralize(t.lines.length, "line")}`, "success");
      onSaved?.(t, useNow);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg, "critical");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Upload a purchase order template"
      subtitle="A sheet with a SKU (or supplier part number) and a quantity per row. Unit cost, a note and a supplier column are picked up when present."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save(false)} loading={busy} disabled={!result?.lines.length || !name.trim()}>
            Save template
          </Button>
          <Button variant="primary" onClick={() => void save(true)} loading={busy} disabled={!result?.lines.length || !name.trim()}>
            Save and start an order
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!source ? (
          <div className="flex flex-col gap-3">
            <div
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-border px-6 py-10 text-center hover:bg-surface-subdued"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void onFile(e.dataTransfer.files[0]);
              }}
            >
              <FileUp className="h-5 w-5 text-icon" />
              <div className="text-[13px] font-medium text-text">Drop a CSV or TSV here, or click to choose</div>
              <div className="text-[12px] text-text-secondary">Columns like SKU, Qty, Unit cost, Note. Exports from a supplier portal or a spreadsheet work as they are.</div>
              <input ref={inputRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
            </div>
            <TextArea label="Or paste rows" hint="(with a header line)" value={pasted} onChange={(e) => setPasted(e.target.value)} rows={4} placeholder={"SKU,Qty,Unit cost\nENC-125B-RAW,200,4.85"} />
            <div>
              <Button size="sm" onClick={() => pasted.trim() && load(parsePasted(pasted))} disabled={!pasted.trim()}>
                Use pasted rows
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Banner tone={result?.lines.length ? "success" : "warning"} title={`${source.name}: ${pluralize(result?.matched.length ?? 0, "row")} matched an item${result?.unknown.length ? `, ${pluralize(result.unknown.length, "row")} did not` : ""}`}>
              {result?.unknown.length ? (
                <span>
                  Not found: {result.unknown.slice(0, 8).map((u) => u.code).join(", ")}
                  {result.unknown.length > 8 ? ` and ${result.unknown.length - 8} more` : ""}. Create those items first, or add the supplier part number as a cross-reference, and upload again.
                </span>
              ) : (
                <span>Every row with a quantity matched by SKU, supplier SKU, barcode or cross-reference.</span>
              )}{" "}
              <button type="button" className="text-accent hover:underline" onClick={() => setSource(null)}>
                Choose a different file
              </button>
            </Banner>
            <FormGrid cols={3}>
              {(["sku", "qty", "unitCost"] as Field[]).map((f) => (
                <Select key={f} label={FIELD_LABEL[f]} value={columns[f] ?? ""} onChange={(e) => setColumns((c) => ({ ...c, [f]: e.target.value || undefined }))} options={headerOptions} />
              ))}
            </FormGrid>
            <FormGrid cols={3}>
              <div className="sm:col-span-2">
                <Combobox label="Supplier" value={supplier} onChange={setSupplier} onCreate={setSupplier} createLabel={(q) => `Use “${q}” as a new supplier`} placeholder="Who this order goes to" options={supplierOptions} />
              </div>
              <Select label={FIELD_LABEL.note} value={columns.note ?? ""} onChange={(e) => setColumns((c) => ({ ...c, note: e.target.value || undefined }))} options={headerOptions} />
            </FormGrid>
            <FormGrid cols={2}>
              <TextField label="Template name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Mouser monthly" />
              <TextField label="Description" hint="(optional)" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When to use it" />
            </FormGrid>
            {result && result.matched.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-[var(--radius)] border border-border text-[12.5px]">
                <table className="w-full">
                  <thead className="bg-surface-subdued text-[11.5px] uppercase tracking-wide text-text-tertiary">
                    <tr>
                      <th className="px-2 py-1 text-left">In file</th>
                      <th className="px-2 py-1 text-left">Item</th>
                      <th className="px-2 py-1 text-right">Qty</th>
                      <th className="px-2 py-1 text-right">Unit cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.matched.slice(0, 60).map((m) => (
                      <tr key={m.row} className="border-t border-border">
                        <td className="px-2 py-1 font-mono">{m.code}</td>
                        <td className="px-2 py-1">
                          <span className="font-mono">{m.item!.sku}</span> <span className="text-text-secondary">{m.item!.name}</span>
                        </td>
                        <td className="px-2 py-1 text-right tabular">{m.qty}</td>
                        <td className="px-2 py-1 text-right tabular text-text-secondary">{m.unitCost ?? "supplier cost"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>
    </Modal>
  );
}
