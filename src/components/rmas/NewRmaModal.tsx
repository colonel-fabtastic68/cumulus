"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Item, Rma, RmaCondition } from "@/lib/types";
import { createRma } from "@/lib/inventory";
import { useCollection, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { newId } from "@/lib/utils";
import { Button, FormGrid, IconButton, Modal, Select, TextArea, TextField, useToast } from "@/components/ui";
import { ItemPicker } from "@/components/inventory";

export const RMA_CONDITIONS: Array<{ value: RmaCondition; label: string }> = [
  { value: "good", label: "Good" },
  { value: "damaged", label: "Damaged" },
  { value: "unknown", label: "Unknown" },
];

interface LineDraft {
  key: string;
  item: Item | null;
  qty: string;
  condition: RmaCondition;
}

const newLine = (): LineDraft => ({ key: newId("ln"), item: null, qty: "1", condition: "unknown" });

interface NewRmaModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (rma: Rma) => void;
}

/** Mounts the form only while open so every opening starts from a clean state. */
export function NewRmaModal(props: NewRmaModalProps) {
  if (!props.open) return null;
  return <NewRmaForm {...props} />;
}

function NewRmaForm({ open, onClose, onCreated }: NewRmaModalProps) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const orders = useCollection("orders");

  const [customer, setCustomer] = useState("");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recentOrders = useMemo(() => [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 25), [orders]);
  const matchedOrder = useMemo(() => {
    const ref = reference.trim().toLowerCase();
    return ref ? orders.find((o) => o.number.toLowerCase() === ref) : undefined;
  }, [orders, reference]);

  const chosenIds = lines.map((l) => l.item?.id).filter((id): id is string => !!id);

  const changeReference = (value: string) => {
    setReference(value);
    const order = orders.find((o) => o.number.toLowerCase() === value.trim().toLowerCase());
    if (order && !customer.trim()) setCustomer(order.customer);
  };

  const updateLine = (key: string, patch: Partial<LineDraft>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((prev) => (prev.length === 1 ? [newLine()] : prev.filter((l) => l.key !== key)));

  const submit = async () => {
    const filled = lines.filter((l) => l.item);
    if (!customer.trim()) return setError("Enter the customer");
    if (!reason.trim()) return setError("Enter the reason for the return");
    if (filled.length === 0) return setError("Add at least one item");
    for (const l of filled) {
      const n = Number(l.qty);
      if (!Number.isFinite(n) || n <= 0) return setError(`Enter a quantity for ${l.item!.sku}`);
    }
    setBusy(true);
    setError(null);
    try {
      const rma = await createRma(store, user, {
        customer: customer.trim(),
        orderId: matchedOrder?.id,
        reference: reference.trim() || undefined,
        reason: reason.trim(),
        note: note.trim() || undefined,
        lines: filled.map((l) => ({ itemId: l.item!.id, qty: Number(l.qty), condition: l.condition })),
      });
      toast(`Opened ${rma.number} for ${rma.customer}`, "success");
      onCreated?.(rma);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New RMA"
      subtitle="Log goods coming back from a customer. Stock only changes when the RMA is resolved."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            Open RMA
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormGrid cols={2}>
          <TextField label="Customer" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Chicago Music Exchange" autoFocus />
          <div>
            <TextField
              label="Reference"
              hint="(order number)"
              value={reference}
              onChange={(e) => changeReference(e.target.value)}
              list="rma-recent-orders"
              placeholder="SO-1088"
              className="font-mono uppercase"
              help={matchedOrder ? `Linked to ${matchedOrder.number} · ${matchedOrder.customer}` : undefined}
            />
            <datalist id="rma-recent-orders">
              {recentOrders.map((o) => (
                <option key={o.id} value={o.number}>
                  {o.customer}
                </option>
              ))}
            </datalist>
          </div>
        </FormGrid>
        <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Cosmetic scratch on enclosure" />

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-text">Items coming back</span>
            <Button size="sm" variant="plain" icon={<Plus />} onClick={() => setLines((prev) => [...prev, newLine()])}>
              Add line
            </Button>
          </div>
          <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-border p-3">
            <div className="hidden grid-cols-[minmax(0,1fr)_88px_128px_32px] gap-2 text-[12px] font-medium text-text-secondary sm:grid">
              <span>Item</span>
              <span>Qty</span>
              <span>Condition</span>
              <span />
            </div>
            {lines.map((l) => (
              <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_32px] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_88px_128px_32px]">
                <ItemPicker value={l.item} onChange={(item) => updateLine(l.key, { item })} exclude={chosenIds.filter((id) => id !== l.item?.id)} />
                <IconButton variant="plain" aria-label="Remove line" className="text-text-tertiary hover:text-critical sm:order-last" onClick={() => removeLine(l.key)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
                <div className="col-span-2 grid grid-cols-2 gap-2 sm:contents">
                  <TextField type="number" min={1} step="any" value={l.qty} onChange={(e) => updateLine(l.key, { qty: e.target.value })} aria-label="Quantity" suffix={l.item && l.item.unit !== "ea" ? l.item.unit : undefined} />
                  <Select value={l.condition} onChange={(e) => updateLine(l.key, { condition: e.target.value as RmaCondition })} options={RMA_CONDITIONS} aria-label="Condition" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <TextArea label="Note" hint="(optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Replacement already shipped, customer will return the original." />
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>
    </Modal>
  );
}
