"use client";

import { useMemo, useState } from "react";
import { BookmarkPlus, Plus, Trash2 } from "lucide-react";
import type { Item, PurchaseOrder, PurchaseOrderTemplate } from "@/lib/types";
import { upsertSupplier } from "@/lib/inventory";
import { createPurchaseOrder, savePurchaseOrderTemplate, unitCostFor, updatePurchaseOrder, type PoSuggestion } from "@/lib/purchaseOrders";
import { useCollection, useSettings, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { cn, newId, round, sum } from "@/lib/utils";
import { Button, Checkbox, Combobox, FormGrid, IconButton, Modal, TextArea, TextField, useToast } from "@/components/ui";
import { ItemPicker } from "@/components/inventory";
import { currencySymbol } from "./poUtils";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated?: (po: PurchaseOrder) => void;
  /** Start pre-filled from a saved template. */
  template?: PurchaseOrderTemplate | null;
  /** Start pre-filled from a low-stock suggestion. */
  suggestion?: PoSuggestion | null;
  /** Edit an open order that has nothing received yet. */
  editing?: PurchaseOrder | null;
}

/** Mounts the form only while open so every opening starts from a clean state. */
export function NewPurchaseOrderModal(props: Props) {
  if (!props.open) return null;
  return <PurchaseOrderForm key={props.editing?.id ?? props.template?.id ?? (props.suggestion ? `s-${props.suggestion.supplier}` : "new")} {...props} />;
}

interface LineState {
  key: string;
  item: Item | null;
  qty: string;
  unitCost: string;
  costTouched: boolean;
}

const newLine = (): LineState => ({ key: newId("ln"), item: null, qty: "1", unitCost: "", costTouched: false });

function PurchaseOrderForm({ open, onClose, onCreated, template, suggestion, editing }: Props) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const suppliers = useCollection("suppliers");
  const allItems = useCollection("items");
  const { currency } = useSettings();
  const symbol = currencySymbol(currency);

  const initialSupplier = editing?.supplier ?? template?.supplier ?? suggestion?.supplier ?? "";
  const [supplier, setSupplier] = useState(initialSupplier === "No supplier set" ? "" : initialSupplier);
  const supplierRecord = useMemo(() => suppliers.find((s) => s.name.toLowerCase() === supplier.trim().toLowerCase()), [suppliers, supplier]);
  const [number, setNumber] = useState(editing?.number ?? "");
  const [expectedAt, setExpectedAt] = useState(editing?.expectedAt ?? "");
  const [terms, setTerms] = useState(editing?.terms ?? template?.terms ?? "");
  const [reference, setReference] = useState(editing?.reference ?? "");
  const [note, setNote] = useState(editing?.note ?? template?.note ?? "");
  const [send, setSend] = useState(false);
  const [lines, setLines] = useState<LineState[]>(() => {
    const supplierId = editing?.supplierId ?? template?.supplierId ?? suggestion?.supplierId;
    const from = editing
      ? editing.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitCost: l.unitCost as number | undefined }))
      : template
        ? template.lines
        : suggestion
          ? suggestion.lines.map((l) => ({ itemId: l.item.id, qty: l.qty, unitCost: l.unitCost as number | undefined }))
          : [];
    const built = from.flatMap((l) => {
      const item = allItems.find((i) => i.id === l.itemId);
      if (!item) return [];
      const cost = l.unitCost ?? unitCostFor(item, supplierId);
      return [{ key: newId("ln"), item, qty: String(l.qty), unitCost: String(cost), costTouched: l.unitCost !== undefined }];
    });
    return built.length ? built : [newLine()];
  });
  const [templateModal, setTemplateModal] = useState(false);
  const [templateName, setTemplateName] = useState(template?.name ?? "");
  const [templateNote, setTemplateNote] = useState(template?.description ?? "");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Picking a known supplier fills in its terms and re-prices untouched lines at that supplier's cost.
  const onSupplierChange = (value: string) => {
    setSupplier(value);
    const known = suppliers.find((s) => s.name.toLowerCase() === value.trim().toLowerCase());
    if (known?.terms && !terms) setTerms(known.terms);
    setLines((prev) => prev.map((l) => (l.item && !l.costTouched ? { ...l, unitCost: String(unitCostFor(l.item, known?.id)) } : l)));
  };
  const supplierOptions = useMemo(() => [...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ value: s.name, label: s.name, description: [s.terms, s.leadTimeDays ? `${s.leadTimeDays} day lead time` : ""].filter(Boolean).join(" · ") || undefined })), [suppliers]);

  const patchLine = (key: string, fn: (l: LineState) => LineState) => setLines((prev) => prev.map((l) => (l.key === key ? fn(l) : l)));
  const setItem = (key: string, item: Item | null) => patchLine(key, (l) => ({ ...l, item, unitCost: item ? String(unitCostFor(item, supplierRecord?.id)) : "", costTouched: false }));
  const lineTotal = (l: LineState) => {
    const q = Number(l.qty);
    const c = Number(l.unitCost);
    return Number.isFinite(q) && Number.isFinite(c) ? round(q * c) : 0;
  };
  const validLines = lines.filter((l) => l.item && Number(l.qty) > 0);
  const total = round(sum(validLines.map(lineTotal)));

  const resolveSupplierId = async (): Promise<string | undefined> => {
    if (supplierRecord) return supplierRecord.id;
    if (!supplier.trim()) return undefined;
    const created = await upsertSupplier(store, user, { name: supplier.trim() });
    return created.id;
  };

  const submit = async () => {
    if (!supplier.trim()) return setError("Choose a supplier");
    if (validLines.length === 0) return setError("Add at least one line with an item and a quantity");
    for (const l of validLines) {
      const c = Number(l.unitCost);
      if (!Number.isFinite(c) || c < 0) return setError(`Enter a unit cost for ${l.item!.sku}`);
    }
    setBusy(true);
    setError(null);
    try {
      const supplierId = await resolveSupplierId();
      const payload = validLines.map((l) => ({ itemId: l.item!.id, qty: Number(l.qty), unitCost: Number(l.unitCost) }));
      if (editing) {
        const po = await updatePurchaseOrder(store, user, editing.id, { supplierId, supplier: supplier.trim(), lines: payload, expectedAt, terms, reference, note });
        toast(`Updated ${po.number}`, "success");
        onCreated?.(po);
      } else {
        const po = await createPurchaseOrder(store, user, { supplierId, supplier: supplier.trim(), number: number.trim() || undefined, lines: payload, expectedAt, terms, reference, note, templateId: template?.id, source: template ? "template" : suggestion ? "suggestion" : "manual", send });
        toast(`${send ? "Sent" : "Created"} ${po.number} to ${po.supplier}`, "success");
        onCreated?.(po);
      }
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg, "critical");
    } finally {
      setBusy(false);
    }
  };

  const saveTemplate = async () => {
    if (!templateName.trim() || validLines.length === 0) return;
    setSavingTemplate(true);
    try {
      const supplierId = await resolveSupplierId();
      const t = await savePurchaseOrderTemplate(store, user, { name: templateName, description: templateNote, supplierId, supplier: supplier.trim(), terms, note, lines: validLines.map((l) => ({ itemId: l.item!.id, qty: Number(l.qty), unitCost: l.costTouched && l.unitCost !== "" ? Number(l.unitCost) : undefined })) }, template?.id);
      toast(`Saved template “${t.name}”`, "success");
      setTemplateModal(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save the template", "critical");
    } finally {
      setSavingTemplate(false);
    }
  };

  const leadHint = supplierRecord?.leadTimeDays ? `${supplierRecord.name} usually takes ${supplierRecord.leadTimeDays} days` : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.number}` : "New purchase order"}
      subtitle={editing ? "Nothing has been received yet, so the lines can still change." : template ? `From template “${template.name}”. Check quantities and costs, then create.` : suggestion ? `Everything below minimum from ${suggestion.supplier}, at reorder quantity.` : "Stock lands when the delivery is received against the order."}
      size="lg"
      footer={
        <>
          <Button variant="plain" icon={<BookmarkPlus />} onClick={() => setTemplateModal(true)} disabled={validLines.length === 0} className="mr-auto">
            Save as template
          </Button>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={validLines.length === 0}>
            {editing ? "Save changes" : send ? "Create and mark sent" : "Create purchase order"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormGrid cols={3}>
          <div className="sm:col-span-2">
            <Combobox label="Supplier" value={supplier} onChange={onSupplierChange} onCreate={onSupplierChange} createLabel={(q) => `Use “${q}” as a new supplier`} placeholder="Type a supplier name" options={supplierOptions} />
          </div>
          {!editing && <TextField label="PO number" hint="(optional)" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Next PO number" help="Leave blank for the next PO-xxxx." />}
        </FormGrid>
        <FormGrid cols={3}>
          <TextField label="Expected" hint="(optional)" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} help={leadHint} />
          <TextField label="Terms" hint="(optional)" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Net 30" />
          <TextField label="Supplier reference" hint="(optional)" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Quote or confirmation #" />
        </FormGrid>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-text">Lines</span>
            <Button size="sm" variant="plain" icon={<Plus />} onClick={() => setLines((prev) => [...prev, newLine()])}>
              Add line
            </Button>
          </div>
          <div className="rounded-[var(--radius)] border border-border">
            <div className="hidden grid-cols-[minmax(0,1fr)_84px_120px_100px_32px] gap-2 border-b border-border bg-surface-subdued px-3 py-1.5 text-[12px] font-medium text-text-secondary sm:grid">
              <span>Item</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Unit cost</span>
              <span className="text-right">Total</span>
              <span />
            </div>
            {lines.map((l) => {
              const q = Number(l.qty);
              return (
                <div key={l.key} className="grid grid-cols-1 gap-2 border-b border-border px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_84px_120px_100px_32px] sm:items-start">
                  <div className="min-w-0">
                    <ItemPicker value={l.item} onChange={(item) => setItem(l.key, item)} filter={(i) => i.status === "active"} placeholder="Search SKU or name" />
                    {l.item && (
                      <p className="mt-1 text-[12px] text-text-tertiary">
                        {l.item.onHand} on hand{l.item.minQty !== undefined ? ` · min ${l.item.minQty}` : ""}
                        {Number.isFinite(q) && l.item.minQty !== undefined && l.item.onHand + q < l.item.minQty ? <span className="text-warning"> · still below min after this</span> : null}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:contents">
                    <TextField type="number" min={0} step="any" value={l.qty} onChange={(e) => patchLine(l.key, (x) => ({ ...x, qty: e.target.value }))} aria-label="Quantity" className="text-right" />
                    <TextField type="number" min={0} step="any" prefix={symbol} value={l.unitCost} onChange={(e) => patchLine(l.key, (x) => ({ ...x, unitCost: e.target.value, costTouched: true }))} aria-label="Unit cost" className="text-right" disabled={!l.item} />
                    <div className={cn("flex h-8 items-center justify-end text-[13px] tabular", l.item ? "text-text" : "text-text-tertiary")}>{l.item ? formatMoney(lineTotal(l), currency) : "—"}</div>
                  </div>
                  <div className="flex justify-end sm:justify-center">
                    <IconButton variant="plain" size="md" onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} aria-label="Remove line" className="text-text-tertiary hover:text-critical">
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconButton>
                  </div>
                </div>
              );
            })}
            <div className="flex items-center justify-between border-t border-border bg-surface-subdued px-3 py-2 text-[13px]">
              <span className="text-text-secondary">
                {validLines.length} {validLines.length === 1 ? "line" : "lines"}
              </span>
              <span className="font-semibold tabular">{formatMoney(total, currency)}</span>
            </div>
          </div>
        </div>

        <TextArea label="Note" hint="(optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Printed on the order: delivery instructions, split shipments, etc." />
        {!editing && <Checkbox label="Mark as sent" help="You have sent or will send the order to the supplier now. Drafts stay editable." checked={send} onChange={setSend} />}
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>
      <Modal
        open={templateModal}
        onClose={() => setTemplateModal(false)}
        size="sm"
        title={template ? "Update template" : "Save as template"}
        subtitle="Supplier, lines, terms and note are kept. Costs you typed by hand are saved; the rest follow the supplier's cost when the template is used."
        footer={
          <>
            <Button onClick={() => setTemplateModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void saveTemplate()} loading={savingTemplate} disabled={!templateName.trim()}>
              {template ? "Update template" : "Save template"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <TextField label="Template name" value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder={supplier ? `${supplier} monthly` : "Monthly restock"} autoFocus />
          <TextField label="Description" hint="(optional)" value={templateNote} onChange={(e) => setTemplateNote(e.target.value)} placeholder="When to use it" />
        </div>
      </Modal>
    </Modal>
  );
}
