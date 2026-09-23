"use client";

import { useState } from "react";
import type { PurchaseOrder, Receipt } from "@/lib/types";
import { poLineOpenQty, poOpenLines, receivePurchaseOrder } from "@/lib/purchaseOrders";
import { useDefaultLocation, useLocations } from "@/lib/locations";
import { useItemsById, useSettings, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { formatMoney, fromDateInput, toDateInput } from "@/lib/format";
import { round, sum } from "@/lib/utils";
import { Button, Checkbox, FormGrid, Modal, Select, TextArea, TextField, useToast } from "@/components/ui";
import { currencySymbol } from "./poUtils";

interface Props {
  po: PurchaseOrder | null;
  onClose: () => void;
  onReceived?: (po: PurchaseOrder, receipt: Receipt) => void;
}

/** Mounts per order so quantities never leak between orders. */
export function ReceivePurchaseOrderModal({ po, ...rest }: Props) {
  if (!po) return null;
  return <ReceiveForm key={po.id} po={po} {...rest} />;
}

function ReceiveForm({ po, onClose, onReceived }: Props & { po: PurchaseOrder }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const itemsById = useItemsById();
  const { currency } = useSettings();
  const symbol = currencySymbol(currency);
  const locations = useLocations();
  const home = useDefaultLocation();
  const [locationId, setLocationId] = useState(home.id);
  const [date, setDate] = useState(() => toDateInput());
  const [note, setNote] = useState("");
  const [updateCost, setUpdateCost] = useState(true);
  const [rows, setRows] = useState(() => poOpenLines(po).map((l) => ({ itemId: l.itemId, open: poLineOpenQty(l), qty: String(poLineOpenQty(l)), unitCost: String(l.unitCost) })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const receiving = rows.filter((r) => Number(r.qty) > 0);
  const total = round(sum(receiving.map((r) => Number(r.qty) * Number(r.unitCost || 0))));
  const everything = rows.every((r) => Number(r.qty) === r.open);

  const submit = async () => {
    if (receiving.length === 0) return setError("Enter a quantity on at least one line");
    for (const r of rows) {
      const q = Number(r.qty);
      if (!Number.isFinite(q) || q < 0) return setError(`Enter a valid quantity for ${itemsById.get(r.itemId)?.sku ?? r.itemId}`);
      if (q > r.open) return setError(`${itemsById.get(r.itemId)?.sku ?? r.itemId}: ${q} is more than the ${r.open} still open`);
    }
    setBusy(true);
    setError(null);
    try {
      const result = await receivePurchaseOrder(store, user, po.id, { lines: receiving.map((r) => ({ itemId: r.itemId, qty: Number(r.qty), unitCost: Number(r.unitCost) || undefined, locationId })), receivedAt: fromDateInput(date), note: note.trim() || undefined, updateStandardCost: updateCost });
      toast(`${result.receipt.number} received against ${po.number}${result.po.status === "received" ? " · order complete" : ""}`, "success");
      onReceived?.(result.po, result.receipt);
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
      open
      onClose={onClose}
      size="lg"
      title={`Receive against ${po.number}`}
      subtitle={`${po.supplier}. Quantities default to what is still open; lower them for a partial delivery.`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={receiving.length === 0}>
            {everything ? "Receive everything" : "Receive these lines"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormGrid cols={2}>
          <TextField label="Received on" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Select label="Location" value={locationId} onChange={(e) => setLocationId(e.target.value)} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
        </FormGrid>
        <div className="rounded-[var(--radius)] border border-border">
          <div className="hidden grid-cols-[minmax(0,1fr)_90px_90px_120px] gap-2 border-b border-border bg-surface-subdued px-3 py-1.5 text-[12px] font-medium text-text-secondary sm:grid">
            <span>Item</span>
            <span className="text-right">Open</span>
            <span className="text-right">Receive</span>
            <span className="text-right">Unit cost</span>
          </div>
          {rows.map((r) => {
            const item = itemsById.get(r.itemId);
            return (
              <div key={r.itemId} className="grid grid-cols-1 gap-2 border-b border-border px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_90px_90px_120px] sm:items-center">
                <div className="min-w-0">
                  <div className="truncate font-mono text-[12.5px] text-text">{item?.sku ?? r.itemId}</div>
                  <div className="truncate text-[12px] text-text-secondary">{item?.name}</div>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:contents">
                  <div className="flex h-8 items-center justify-end text-[13px] tabular text-text-secondary">{r.open}</div>
                  <TextField type="number" min={0} max={r.open} step="any" value={r.qty} onChange={(e) => setRows((prev) => prev.map((x) => (x.itemId === r.itemId ? { ...x, qty: e.target.value } : x)))} aria-label="Quantity to receive" className="text-right" />
                  <TextField type="number" min={0} step="any" prefix={symbol} value={r.unitCost} onChange={(e) => setRows((prev) => prev.map((x) => (x.itemId === r.itemId ? { ...x, unitCost: e.target.value } : x)))} aria-label="Unit cost" className="text-right" />
                </div>
              </div>
            );
          })}
          <div className="flex items-center justify-between border-t border-border bg-surface-subdued px-3 py-2 text-[13px]">
            <span className="text-text-secondary">
              {receiving.length} {receiving.length === 1 ? "line" : "lines"} · {sum(receiving.map((r) => Number(r.qty)))} units
            </span>
            <span className="font-semibold tabular">{formatMoney(total, currency)}</span>
          </div>
        </div>
        <TextArea label="Note" hint="(optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Packing slip number, damage, short-shipped lines…" />
        <Checkbox label="Update standard cost to the received cost" checked={updateCost} onChange={setUpdateCost} />
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>
    </Modal>
  );
}
