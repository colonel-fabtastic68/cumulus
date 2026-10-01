"use client";

import { useMemo, useRef, useState } from "react";
import { ClipboardCheck, Plus } from "lucide-react";
import type { Item, PurchaseOrder, Receipt } from "@/lib/types";
import { costingMethod, receiveStock, type ReceiveLineInput } from "@/lib/inventory";
import { poIsOpen, poLineOpenQty, poOpenLines, receivePurchaseOrders } from "@/lib/purchaseOrders";
import { COSTING_LABELS } from "@/lib/valuation";
import { useDefaultLocation, useLocations } from "@/lib/locations";
import { findItemByCode } from "@/lib/scan";
import { ScanField } from "@/components/scan";
import { ItemPicker } from "@/components/inventory";
import { useCollection, useItems, useSettings, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { formatDate, formatMoney, formatNumber, fromDateInput, pluralize, toDateInput } from "@/lib/format";
import { cn, newId, uniq } from "@/lib/utils";
import { Badge, Button, Drawer, FormGrid, Select, TextArea, TextField, Toggle, useToast } from "@/components/ui";
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
  return { key: newId("ln"), item: null, qty: "", unitCost: "", bin: "", supplierLot: "", expiresAt: "", autoFocus };
}

const activeOnly = (item: Item) => item.status === "active";

function ReceiveForm({ open, onClose, onReceived }: ReceiveDrawerProps) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const settings = useSettings();
  const { currency } = settings;
  const method = costingMethod(settings);
  const suppliers = useCollection("suppliers");
  const purchaseOrders = useCollection("purchaseOrders");
  const items = useItems();

  const locations = useLocations();
  const home = useDefaultLocation();
  const [locationId, setLocationId] = useState(home.id);
  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(() => toDateInput());
  const [lines, setLines] = useState<LineDraft[]>(() => [newLine()]);
  const [updateCost, setUpdateCost] = useState(true);
  const [trackLots, setTrackLots] = useState(false);
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
  const openPos = useMemo(() => (supplierId ? purchaseOrders.filter((p) => poIsOpen(p) && p.supplierId === supplierId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : []), [purchaseOrders, supplierId]);
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
  const poLineCount = lines.filter((l) => l.purchaseOrderId).length;

  const patchLine = (key: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const pickItem = (key: string, item: Item | null) => {
    patchLine(key, { item, unitCost: item ? String(item.unitCost) : "" });
    if (item) requestAnimationFrame(() => qtyInputs.current.get(key)?.focus());
  };
  const removeLine = (key: string) => setLines((ls) => (ls.length === 1 ? [newLine()] : ls.filter((l) => l.key !== key)));
  /** Factor 32: each scan adds a unit of the matching item, or starts a new line for it. */
  const onScan = (code: string) => {
    const match = findItemByCode(items, code);
    if (!match) return toast(`No item matches ${code}`, "critical");
    addItem(match.item);
  };
  /** A picked or scanned item: one more unit on its line, or a new line. */
  const addItem = (item: Item) => {
    setLines((ls) => {
      const existing = ls.find((l) => l.item?.id === item.id);
      if (existing) return ls.map((l) => (l === existing ? { ...l, qty: String((Number(l.qty) || 0) + 1) } : l));
      const blank = ls.find((l) => !l.item);
      const fresh = { ...newLine(), item, qty: "1", unitCost: String(item.unitCost) };
      return blank ? ls.map((l) => (l === blank ? fresh : l)) : [...ls, fresh];
    });
  };
  /** Every line still open on an order joins the delivery; lines already added for that order are left alone. */
  const addPurchaseOrder = (po: PurchaseOrder) => {
    setLines((ls) => {
      const fresh = poOpenLines(po)
        .filter((l) => !ls.some((x) => x.purchaseOrderId === po.id && x.item?.id === l.itemId))
        .flatMap((l) => {
          const item = items.find((i) => i.id === l.itemId);
          if (!item) return [];
          const open = poLineOpenQty(l);
          return [{ ...newLine(), item, qty: String(open), unitCost: String(l.unitCost), purchaseOrderId: po.id, poNumber: po.number, open }];
        });
      const kept = ls.filter((l) => l.item);
      return [...kept, ...fresh].length ? [...kept, ...fresh] : [newLine()];
    });
  };
  const addLine = () => setLines((ls) => [...ls, newLine(true)]);
  const registerQtyInput = (key: string) => (el: HTMLInputElement | null) => {
    if (el) qtyInputs.current.set(key, el);
    else qtyInputs.current.delete(key);
  };

  const submit = async () => {
    setError(null);
    const payload: Array<ReceiveLineInput & { purchaseOrderId?: string }> = [];
    for (const [i, l] of lines.entries()) {
      if (!l.item) {
        if (l.qty.trim() || l.unitCost.trim()) return setError(`Choose an item for line ${i + 1}`);
        continue;
      }
      const qty = Number(l.qty);
      if (!l.qty.trim() || !Number.isFinite(qty) || qty <= 0) return setError(`Enter a quantity for ${l.item.sku}`);
      if (l.open !== undefined && qty > l.open + 1e-9) return setError(`${l.item.sku}: ${qty} is more than the ${l.open} still open on ${l.poNumber}`);
      const unitCost = l.unitCost.trim() === "" ? undefined : Number(l.unitCost);
      if (unitCost !== undefined && (!Number.isFinite(unitCost) || unitCost < 0)) return setError(`Enter a valid unit cost for ${l.item.sku}`);
      payload.push({ itemId: l.item.id, qty, unitCost, locationId: locationId !== home.id ? locationId : undefined, bin: l.bin.trim() || undefined, supplierLot: trackLots ? l.supplierLot.trim() || undefined : undefined, expiresAt: trackLots ? l.expiresAt || undefined : undefined, purchaseOrderId: l.purchaseOrderId });
    }
    if (payload.length === 0) return setError("Add at least one item to receive");
    const poIds = uniq(payload.map((l) => l.purchaseOrderId).filter((id): id is string => !!id));
    const foreign = poIds.map((id) => purchaseOrders.find((p) => p.id === id)).find((p) => p && p.supplierId !== (supplierId || undefined));
    if (foreign) return setError(`${foreign.number} is an order to ${foreign.supplier}; pick that supplier or remove its lines`);
    setBusy(true);
    try {
      const common = { reference: reference.trim() || undefined, receivedAt: fromDateInput(date), note: note.trim() || undefined, updateStandardCost: method === "standard" ? updateCost : undefined };
      const receipt = poIds.length
        ? (await receivePurchaseOrders(store, user, poIds, { ...common, lines: payload, allowExtraLines: true })).receipt
        : await receiveStock(store, user, { ...common, supplierId: supplierId || undefined, lines: payload });
      toast(`Received ${receipt.number}${poIds.length ? ` against ${receipt.reference}` : ""}`, "success");
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
      subtitle="Creates a numbered batch per line and posts receipt movements to the ledger."
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
        {openPos.length > 0 && (
          <div className="rounded-[var(--radius)] border border-border">
            <div className="flex items-center gap-2 border-b border-border bg-surface-subdued px-3 py-1.5 text-[12px] font-medium text-text-secondary">
              <ClipboardCheck className="h-3.5 w-3.5" />
              Open orders from {supplier?.name}
              <span className="font-normal text-text-tertiary">· one delivery can cover several</span>
            </div>
            <ul className="divide-y divide-border">
              {openPos.map((po) => {
                const added = lines.some((l) => l.purchaseOrderId === po.id);
                const openLines = poOpenLines(po);
                return (
                  <li key={po.id} className="flex items-center gap-3 px-3 py-1.5 text-[12.5px]">
                    <span className="font-mono font-medium text-text">{po.number}</span>
                    <span className="min-w-0 flex-1 truncate text-text-secondary">
                      {pluralize(openLines.length, "line")} open{po.expectedAt ? ` · expected ${formatDate(po.expectedAt)}` : ""}
                      {po.reference ? ` · ref ${po.reference}` : ""}
                    </span>
                    {added ? <Badge tone="success">Added</Badge> : <Button size="sm" onClick={() => addPurchaseOrder(po)}>Add lines</Button>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {locations.length > 1 && (
          <Select label="Receive into" value={locationId} onChange={(e) => setLocationId(e.target.value)} options={locations.map((l) => ({ value: l.id, label: l.code ? `${l.name} (${l.code})` : l.name }))} help="Stock lands at this location; set a bin per line for put-away." />
        )}
        <FormGrid cols={2}>
          <TextField label="Reference" hint="(optional)" placeholder={poLineCount ? "Defaults to the order numbers" : "PO or packing slip number"} value={reference} onChange={(e) => setReference(e.target.value)} />
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
            <span>Bin</span>
            <span className="text-right">Total</span>
            <span />
          </div>
          <div className="flex flex-col gap-2">
            <div className="px-3 pt-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ScanField label="Scan to add" placeholder="Scan a barcode or type a SKU and press Enter" onScan={onScan} />
                <ItemPicker label="Or find an item" placeholder="Search SKU, name or cross-reference" value={null} onChange={(item) => item && addItem(item)} />
              </div>
            </div>
            {lines.map((line) => (
              <ReceiveLineRow
                key={line.key}
                line={line}
                currency={currency}
                symbol={symbol}
                supplierId={supplierId || undefined}
                suppliersById={suppliersById}
                filter={activeOnly}
                trackLots={trackLots}
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

        <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-border p-3">
          <Toggle label="Record supplier lot numbers and expiry dates" help="Every line becomes a numbered batch regardless; this adds the supplier's own code and any expiry for traceability." checked={trackLots} onChange={setTrackLots} />
          {method === "standard" ? (
            <Toggle
              label="Update standard cost to received cost"
              help="Each received item's unit cost becomes the cost on this receipt."
              checked={updateCost}
              onChange={setUpdateCost}
            />
          ) : (
            <p className="text-[12px] text-text-tertiary">
              Costing: {COSTING_LABELS[method]}. {method === "average" ? "Each item's cost moves to the weighted average of what is on hand after this delivery." : "Each line is a new layer at its own cost; consumption takes the oldest layers first."}
            </p>
          )}
        </div>

        <TextArea label="Note" hint="(optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>
    </Drawer>
  );
}
