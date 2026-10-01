"use client";

import { useState } from "react";
import { ClipboardCheck } from "lucide-react";
import type { PurchaseOrder, Receipt } from "@/lib/types";
import { poLineOpenQty, poOpenLines, receivePurchaseOrders } from "@/lib/purchaseOrders";
import { costingMethod } from "@/lib/inventory";
import { COSTING_LABELS } from "@/lib/valuation";
import { printReceivingChecklist } from "@/lib/receivingChecklist";
import { useDefaultLocation, useLocations } from "@/lib/locations";
import { useItemsById, useSettings, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { formatDate, formatMoney, fromDateInput, pluralize, toDateInput } from "@/lib/format";
import { round, sum } from "@/lib/utils";
import { Button, Checkbox, FormGrid, Modal, Select, TextArea, TextField, Toggle, useToast } from "@/components/ui";
import { currencySymbol } from "./poUtils";

interface Props {
  /** One order, or several open orders from the same supplier that arrived on one delivery. */
  pos: PurchaseOrder[] | null;
  onClose: () => void;
  onReceived?: (pos: PurchaseOrder[], receipt: Receipt) => void;
}

/** Mounts per set of orders so quantities never leak between deliveries. */
export function ReceivePurchaseOrderModal({ pos, ...rest }: Props) {
  if (!pos || pos.length === 0) return null;
  return <ReceiveForm key={pos.map((p) => p.id).join("|")} pos={pos} {...rest} />;
}

interface Row {
  key: string;
  purchaseOrderId: string;
  poNumber: string;
  itemId: string;
  open: number;
  qty: string;
  unitCost: string;
  supplierLot: string;
  expiresAt: string;
}

function ReceiveForm({ pos, onClose, onReceived }: Props & { pos: PurchaseOrder[] }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const itemsById = useItemsById();
  const settings = useSettings();
  const { currency } = settings;
  const method = costingMethod(settings);
  const symbol = currencySymbol(currency);
  const locations = useLocations();
  const home = useDefaultLocation();
  const [locationId, setLocationId] = useState(home.id);
  const [date, setDate] = useState(() => toDateInput());
  const [note, setNote] = useState("");
  const [updateCost, setUpdateCost] = useState(true);
  const [trackLots, setTrackLots] = useState(false);
  const [rows, setRows] = useState<Row[]>(() => pos.flatMap((po) => poOpenLines(po).map((l) => ({ key: `${po.id}:${l.itemId}`, purchaseOrderId: po.id, poNumber: po.number, itemId: l.itemId, open: poLineOpenQty(l), qty: String(poLineOpenQty(l)), unitCost: String(l.unitCost), supplierLot: "", expiresAt: "" }))));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numbers = pos.map((p) => p.number).join(", ");
  const supplier = pos[0]!.supplier;
  const receiving = rows.filter((r) => Number(r.qty) > 0);
  const total = round(sum(receiving.map((r) => Number(r.qty) * Number(r.unitCost || 0))));
  const everything = rows.every((r) => Number(r.qty) === r.open);
  const patch = (key: string, p: Partial<Row>) => setRows((prev) => prev.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const printChecklist = () => {
    const sheet = rows.map((r) => ({ sku: itemsById.get(r.itemId)?.sku ?? r.itemId, name: `${itemsById.get(r.itemId)?.name ?? ""}${pos.length > 1 ? ` (${r.poNumber})` : ""}`, qty: r.open, unit: itemsById.get(r.itemId)?.unit, bin: itemsById.get(r.itemId)?.location }));
    if (!printReceivingChecklist({ title: `Receiving checklist ${numbers}`, subtitle: `${supplier} · due on ${pos.length === 1 ? "this order" : "these orders"}`, rows: sheet, companyName: settings.companyName, blankQty: true })) toast("Allow pop-ups to print the checklist", "critical");
  };

  const submit = async () => {
    if (receiving.length === 0) return setError("Enter a quantity on at least one line");
    for (const r of rows) {
      const q = Number(r.qty);
      const sku = itemsById.get(r.itemId)?.sku ?? r.itemId;
      if (!Number.isFinite(q) || q < 0) return setError(`Enter a valid quantity for ${sku}`);
      if (q > r.open) return setError(`${sku}: ${q} is more than the ${r.open} still open on ${r.poNumber}`);
    }
    setBusy(true);
    setError(null);
    try {
      const result = await receivePurchaseOrders(
        store,
        user,
        pos.map((p) => p.id),
        {
          lines: receiving.map((r) => ({ purchaseOrderId: r.purchaseOrderId, itemId: r.itemId, qty: Number(r.qty), unitCost: Number(r.unitCost) || undefined, locationId, supplierLot: trackLots ? r.supplierLot.trim() || undefined : undefined, expiresAt: trackLots ? r.expiresAt || undefined : undefined })),
          receivedAt: fromDateInput(date),
          note: note.trim() || undefined,
          updateStandardCost: method === "standard" ? updateCost : undefined,
        },
      );
      const complete = result.purchaseOrders.filter((p) => p.status === "received").map((p) => p.number);
      toast(`${result.receipt.number} received against ${numbers}${complete.length ? ` · ${complete.join(", ")} complete` : ""}`, "success");
      onReceived?.(result.purchaseOrders, result.receipt);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg, "critical");
    } finally {
      setBusy(false);
    }
  };

  const grid = "sm:grid-cols-[minmax(0,1fr)_80px_90px_120px]";

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={pos.length === 1 ? `Receive against ${numbers}` : `Receive ${pluralize(pos.length, "order")} together`}
      subtitle={`${supplier}${pos.length > 1 ? ` · ${numbers} on one delivery, one receipt` : ""}. Quantities default to what is still open; lower them for a partial delivery.`}
      footer={
        <>
          <Button variant="plain" icon={<ClipboardCheck />} onClick={printChecklist} className="mr-auto">
            Print checklist
          </Button>
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
          <div className={`hidden gap-2 border-b border-border bg-surface-subdued px-3 py-1.5 text-[12px] font-medium text-text-secondary sm:grid ${grid}`}>
            <span>Item</span>
            <span className="text-right">Open</span>
            <span className="text-right">Receive</span>
            <span className="text-right">Unit cost</span>
          </div>
          {rows.map((r, i) => {
            const item = itemsById.get(r.itemId);
            const po = pos.find((p) => p.id === r.purchaseOrderId);
            // A header row above the first line of each order when several are received at once.
            const header = pos.length > 1 && (i === 0 || rows[i - 1]!.purchaseOrderId !== r.purchaseOrderId);
            return (
              <div key={r.key}>
                {header && po && (
                  <div className="flex flex-wrap items-center gap-x-3 border-b border-border bg-surface-subdued/60 px-3 py-1 text-[12px]">
                    <span className="font-mono font-medium text-text">{po.number}</span>
                    {po.reference && <span className="text-text-secondary">ref {po.reference}</span>}
                    {po.expectedAt && <span className="text-text-tertiary">expected {formatDate(po.expectedAt)}</span>}
                  </div>
                )}
                <div className={`grid grid-cols-1 gap-2 border-b border-border px-3 py-2 last:border-b-0 sm:items-center ${grid}`}>
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[12.5px] text-text">{item?.sku ?? r.itemId}</div>
                    <div className="truncate text-[12px] text-text-secondary">{item?.name}</div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 sm:contents">
                    <div className="flex h-8 items-center justify-end text-[13px] tabular text-text-secondary">{r.open}</div>
                    <TextField type="number" min={0} max={r.open} step="any" value={r.qty} onChange={(e) => patch(r.key, { qty: e.target.value })} aria-label="Quantity to receive" className="text-right" />
                    <TextField type="number" min={0} step="any" prefix={symbol} value={r.unitCost} onChange={(e) => patch(r.key, { unitCost: e.target.value })} aria-label="Unit cost" className="text-right" />
                  </div>
                  {trackLots && (
                    <div className="grid grid-cols-2 gap-2 sm:col-span-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:pl-4">
                      <TextField placeholder="Supplier lot / batch #" aria-label="Supplier lot" value={r.supplierLot} onChange={(e) => patch(r.key, { supplierLot: e.target.value })} />
                      <TextField type="date" aria-label="Expires" value={r.expiresAt} onChange={(e) => patch(r.key, { expiresAt: e.target.value })} help={r.expiresAt ? undefined : "Expiry (optional)"} />
                    </div>
                  )}
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
        <Toggle label="Record supplier lot numbers and expiry dates" help="Each line becomes a numbered batch either way; this writes the supplier's own code and any expiry on it for traceability." checked={trackLots} onChange={setTrackLots} />
        <TextArea label="Note" hint="(optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Packing slip number, damage, short-shipped lines…" />
        {method === "standard" ? (
          <Checkbox label="Update standard cost to the received cost" checked={updateCost} onChange={setUpdateCost} />
        ) : (
          <p className="text-[12px] text-text-tertiary">
            Costing: {COSTING_LABELS[method]}. {method === "average" ? "Each item's cost moves to the weighted average of what is on hand after this delivery." : "Each line is a new layer at its own cost; consumption takes the oldest layers first."}
          </p>
        )}
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>
    </Modal>
  );
}
