"use client";

import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { Item, Receipt } from "@/lib/types";
import { receiveStock } from "@/lib/inventory";
import { useCollection, useItems, useSettings, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { formatMoney, formatNumber, fromDateInput, pluralize, toDateInput } from "@/lib/format";
import { cn, newId } from "@/lib/utils";
import { Button, Drawer, FormGrid, Select, TextArea, TextField, Toggle, useToast } from "@/components/ui";
import { currencySymbol } from "./receiptUtils";
import { LINE_GRID, ReceiveLineRow, type LineDraft } from "./ReceiveLineRow";

interface ReceiveDrawerProps {
  open: boolean;
  onClose: () => void;
  onReceived?: (receipt: Receipt) => void;
}

/** Mounts the form only while open so every opening starts from a clean state. */
export function ReceiveDrawer(props: ReceiveDrawerProps) {
  if (!props.open) return null;
  return <ReceiveForm {...props} />;
}

function newLine(autoFocus = false): LineDraft {
  return { key: newId("ln"), item: null, qty: "", unitCost: "", autoFocus };
}

const activeOnly = (item: Item) => item.status === "active";

function ReceiveForm({ open, onClose, onReceived }: ReceiveDrawerProps) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const { currency } = useSettings();
  const suppliers = useCollection("suppliers");
  const items = useItems();

  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(() => toDateInput());
  const [lines, setLines] = useState<LineDraft[]>(() => [newLine()]);
  const [updateCost, setUpdateCost] = useState(true);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qtyInputs = useRef(new Map<string, HTMLInputElement>());

  const suppliersById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const supplierOptions = useMemo(
    () => [...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ value: s.id, label: s.name })),
    [suppliers],
  );
  const supplier = supplierId ? suppliersById.get(supplierId) : undefined;
  const supplierItemCount = useMemo(
    () => (supplierId ? items.filter((i) => i.status === "active" && i.supplierId === supplierId).length : 0),
    [items, supplierId],
  );
  const symbol = useMemo(() => currencySymbol(currency), [currency]);

  const totals = useMemo(() => {
    let total = 0;
    let units = 0;
    let count = 0;
    for (const l of lines) {
      if (!l.item) continue;
      const qty = Number(l.qty);
      if (!(qty > 0)) continue;
      const cost = l.unitCost.trim() === "" ? l.item.unitCost : Number(l.unitCost);
      count++;
      units += qty;
      if (Number.isFinite(cost)) total += qty * cost;
    }
    return { total, units, count };
  }, [lines]);

  const patchLine = (key: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickItem = (key: string, item: Item | null) => {
    patchLine(key, { item, unitCost: item ? String(item.unitCost) : "" });
    if (item) requestAnimationFrame(() => qtyInputs.current.get(key)?.focus());
  };
  const removeLine = (key: string) => setLines((ls) => (ls.length === 1 ? [newLine()] : ls.filter((l) => l.key !== key)));
  const addLine = () => setLines((ls) => [...ls, newLine(true)]);
  const registerQtyInput = (key: string) => (el: HTMLInputElement | null) => {
    if (el) qtyInputs.current.set(key, el);
    else qtyInputs.current.delete(key);
  };

  const submit = async () => {
    setError(null);
    const payload: Array<{ itemId: string; qty: number; unitCost?: number }> = [];
    for (const [i, l] of lines.entries()) {
      if (!l.item) {
        if (l.qty.trim() || l.unitCost.trim()) return setError(`Choose an item for line ${i + 1}`);
        continue;
      }
      const qty = Number(l.qty);
      if (!l.qty.trim() || !Number.isFinite(qty) || qty <= 0) return setError(`Enter a quantity for ${l.item.sku}`);
      const unitCost = l.unitCost.trim() === "" ? undefined : Number(l.unitCost);
      if (unitCost !== undefined && (!Number.isFinite(unitCost) || unitCost < 0)) return setError(`Enter a valid unit cost for ${l.item.sku}`);
      payload.push({ itemId: l.item.id, qty, unitCost });
    }
    if (payload.length === 0) return setError("Add at least one item to receive");
    setBusy(true);
    try {
      const receipt = await receiveStock(store, user, {
        supplierId: supplierId || undefined,
        reference: reference.trim() || undefined,
        receivedAt: fromDateInput(date),
        note: note.trim() || undefined,
        lines: payload,
        updateStandardCost: updateCost,
      });
      toast(`Received ${receipt.number}`, "success");
      onReceived?.(receipt);
      onClose();
    } catch (e) {
      // InventoryError (and anything else thrown by the store) carries a readable message.
      setError(e instanceof Error ? e.message : "Something went wrong while receiving");
    } finally {
      setBusy(false);
    }
  };

  const supplierHelp = supplier
    ? supplier.leadTimeDays !== undefined
      ? `Lead time ${pluralize(supplier.leadTimeDays, "day")}${supplier.terms ? ` · ${supplier.terms}` : ""}`
      : "No lead time on file"
    : undefined;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={560}
      title="Receive stock"
      subtitle="Creates a lot per line and posts receipt movements to the ledger."
      footer={
        <>
          <div className="mr-auto text-[12.5px] text-text-secondary">
            {totals.count > 0 ? (
              <>
                {pluralize(totals.count, "line")} · <span className="font-semibold text-text tabular">{formatMoney(totals.total, currency)}</span>
              </>
            ) : (
              "No lines yet"
            )}
          </div>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={totals.count === 0}>
            Receive stock
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Supplier"
          hint="(optional)"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          placeholder="No supplier"
          options={supplierOptions}
          help={supplierHelp}
        />
        <FormGrid cols={2}>
          <TextField label="Reference" hint="(optional)" placeholder="PO or packing slip number" value={reference} onChange={(e) => setReference(e.target.value)} />
          <TextField
            label="Received date"
            type="date"
            value={date}
            max={toDateInput()}
            onChange={(e) => setDate(e.target.value)}
            help="Back-date if this arrived earlier; today's totals stay correct"
          />
        </FormGrid>

        <div>
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[12.5px] font-medium text-text">Lines</span>
            {supplier && (
              <span className="text-[12px] text-text-tertiary">
                {supplierItemCount > 0 ? `${supplier.name} supplies ${pluralize(supplierItemCount, "active item")}` : `No items are linked to ${supplier.name} yet`} · all active items are listed
              </span>
            )}
          </div>
          <div className={cn("mb-1 hidden gap-2 text-[12px] font-medium text-text-secondary sm:grid", LINE_GRID)}>
            <span>Item</span>
            <span className="text-right">Qty</span>
            <span className="text-right">Unit cost</span>
            <span className="text-right">Total</span>
            <span />
          </div>
          <div className="flex flex-col gap-2">
            {lines.map((line) => (
              <ReceiveLineRow
                key={line.key}
                line={line}
                currency={currency}
                symbol={symbol}
                supplierId={supplierId || undefined}
                suppliersById={suppliersById}
                filter={activeOnly}
                onPick={(item) => pickItem(line.key, item)}
                onChange={(patch) => patchLine(line.key, patch)}
                onRemove={() => removeLine(line.key)}
                qtyRef={registerQtyInput(line.key)}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <Button size="sm" icon={<Plus />} onClick={addLine}>
              Add line
            </Button>
            <div className="text-[12.5px] text-text-secondary tabular">
              {formatNumber(totals.units)} units · <span className="font-semibold text-text">{formatMoney(totals.total, currency)}</span>
            </div>
          </div>
        </div>

        <div className="rounded-[var(--radius)] border border-border p-3">
          <Toggle
            label="Update standard cost to received cost"
            help="Each received item's unit cost becomes the cost on this receipt."
            checked={updateCost}
            onChange={setUpdateCost}
          />
        </div>

        <TextArea label="Note" hint="(optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>
    </Drawer>
  );
}
