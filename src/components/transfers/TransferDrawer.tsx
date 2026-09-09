"use client";

import { useMemo, useState } from "react";
import { ArrowRight, ClipboardPaste, Plus, Trash2 } from "lucide-react";
import type { Item, Transfer } from "@/lib/types";
import { createTransfer, qtyAt } from "@/lib/inventory";
import { useDefaultLocation, useLocations } from "@/lib/locations";
import { findItemByCode } from "@/lib/scan";
import { useItems, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { formatQty, pluralize } from "@/lib/format";
import { newId } from "@/lib/utils";
import { Banner, Button, Drawer, FormGrid, IconButton, Select, TextArea, TextField, useToast } from "@/components/ui";
import { ItemPicker } from "@/components/inventory";
import { ScanField } from "@/components/scan";
import { parseTransferList } from "./transferUtils";

interface LineDraft {
  key: string;
  item: Item | null;
  qty: string;
}

const newLine = (item: Item | null = null, qty = ""): LineDraft => ({ key: newId("tl"), item, qty });

interface TransferDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Items to start with, e.g. the inventory selection. */
  initialItems?: Item[];
  onCreated?: (transfer: Transfer) => void;
}

/** Factor 30: move stock between locations. Lines come from the picker, a scanner, or a pasted list. */
export function TransferDrawer({ open, onClose, initialItems, onCreated }: TransferDrawerProps) {
  if (!open) return null;
  return <TransferForm onClose={onClose} initialItems={initialItems} onCreated={onCreated} />;
}

function TransferForm({ onClose, initialItems, onCreated }: Omit<TransferDrawerProps, "open">) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const items = useItems();
  const locations = useLocations();
  const home = useDefaultLocation();
  const [fromId, setFromId] = useState(home.id);
  // Destination defaults to the first location that is not the origin until the user picks one.
  const [toChoice, setToId] = useState<string | null>(null);
  const toId = toChoice ?? locations.find((l) => l.id !== fromId)?.id ?? "";
  const [lines, setLines] = useState<LineDraft[]>(() => (initialItems?.length ? initialItems.map((i) => newLine(i, "")) : [newLine()]));
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState("");
  const [note, setNote] = useState("");
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(() => locations.map((l) => ({ value: l.id, label: l.code ? `${l.name} (${l.code})` : l.name })), [locations]);
  const available = (item: Item) => qtyAt(item, fromId, home.id);

  const patch = (key: string, p: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const remove = (key: string) => setLines((ls) => (ls.length === 1 ? [newLine()] : ls.filter((l) => l.key !== key)));
  const addItem = (item: Item, qty = 1) =>
    setLines((ls) => {
      const existing = ls.find((l) => l.item?.id === item.id);
      if (existing) return ls.map((l) => (l === existing ? { ...l, qty: String((Number(l.qty) || 0) + qty) } : l));
      const blank = ls.find((l) => !l.item);
      const line = newLine(item, String(qty));
      return blank ? ls.map((l) => (l === blank ? line : l)) : [...ls, line];
    });

  const onScan = (code: string) => {
    const match = findItemByCode(items, code);
    if (!match) return toast(`No item matches ${code}`, "critical");
    addItem(match.item, 1);
  };

  const applyPaste = () => {
    const { lines: parsed, errors } = parseTransferList(pasted, items);
    for (const p of parsed) addItem(p.item, p.qty);
    if (errors.length) setError(errors.slice(0, 3).join(" · ") + (errors.length > 3 ? ` · and ${errors.length - 3} more` : ""));
    else setError(null);
    if (parsed.length) {
      setPasted("");
      setPasteOpen(false);
      toast(`Added ${pluralize(parsed.length, "line")}`, "success");
    }
  };

  const submit = async () => {
    setError(null);
    const payload: Array<{ itemId: string; qty: number }> = [];
    for (const [i, l] of lines.entries()) {
      if (!l.item) {
        if (l.qty.trim()) return setError(`Choose an item for line ${i + 1}`);
        continue;
      }
      const qty = Number(l.qty);
      if (!l.qty.trim() || !Number.isFinite(qty) || qty <= 0) return setError(`Enter a quantity for ${l.item.sku}`);
      if (qty > available(l.item)) return setError(`${l.item.sku}: only ${formatQty(available(l.item), l.item.unit)} at ${locations.find((x) => x.id === fromId)?.name ?? "the origin"}`);
      payload.push({ itemId: l.item.id, qty });
    }
    if (payload.length === 0) return setError("Add at least one line");
    if (!toId) return setError("Choose a destination");
    setBusy(true);
    try {
      const transfer = await createTransfer(store, user, { fromLocationId: fromId, toLocationId: toId, lines: payload, note: note.trim() || undefined, carrier: carrier.trim() || undefined, trackingNumber: tracking.trim() || undefined });
      toast(`Sent ${transfer.number}`, "success");
      onCreated?.(transfer);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the transfer");
    } finally {
      setBusy(false);
    }
  };

  const units = lines.reduce((a, l) => a + (l.item ? Number(l.qty) || 0 : 0), 0);

  return (
    <Drawer
      open
      onClose={onClose}
      width={600}
      title="New transfer"
      subtitle="Stock leaves the origin now and lands when the transfer is received."
      footer={
        <>
          <div className="mr-auto text-[12.5px] text-text-secondary">{units > 0 ? `${units} units on ${pluralize(lines.filter((l) => l.item).length, "line")}` : "No lines yet"}</div>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<ArrowRight />} onClick={submit} loading={busy} disabled={units === 0 || !toId}>
            Send transfer
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {locations.length < 2 && (
          <Banner tone="info" title="Add a second location first">
            Transfers move stock between locations. Add warehouses, trucks or trailers under Settings → Locations.
          </Banner>
        )}
        <FormGrid cols={2}>
          <Select label="From" value={fromId} onChange={(e) => setFromId(e.target.value)} options={options} />
          <Select label="To" value={toId} onChange={(e) => setToId(e.target.value)} placeholder="Choose a destination" options={options.filter((o) => o.value !== fromId)} />
        </FormGrid>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-text">Lines</span>
            <Button size="sm" variant="plain" icon={<ClipboardPaste />} onClick={() => setPasteOpen((v) => !v)}>
              Paste a list
            </Button>
          </div>
          {pasteOpen && (
            <div className="mb-3 rounded-[var(--radius)] border border-border p-3">
              <TextArea label="One item per line: SKU or barcode, then quantity" rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={"ENC-125B-RAW, 40\nSW-3PDT-BLU 12"} />
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="primary" onClick={applyPaste} disabled={!pasted.trim()}>
                  Add rows
                </Button>
                <Button size="sm" onClick={() => setPasteOpen(false)}>
                  Close
                </Button>
              </div>
            </div>
          )}
          <div className="mb-3">
            <ScanField label="Scan to add" placeholder="Each scan adds one unit" onScan={onScan} />
          </div>
          <div className="flex flex-col gap-2">
            {lines.map((line) => (
              <div key={line.key} className="grid grid-cols-[minmax(0,1fr)_96px_32px] items-center gap-2">
                <div className="min-w-0">
                  <ItemPicker value={line.item} onChange={(item) => patch(line.key, { item, qty: line.qty || (item ? "1" : "") })} filter={(i) => i.status === "active"} placeholder="Search SKU, name or barcode" />
                  {line.item && <div className="mt-0.5 text-[11.5px] text-text-tertiary">{formatQty(available(line.item), line.item.unit)} available at origin</div>}
                </div>
                <TextField type="number" min={0} step="any" value={line.qty} onChange={(e) => patch(line.key, { qty: e.target.value })} aria-label="Quantity" className="text-right" />
                <IconButton variant="plain" onClick={() => remove(line.key)} aria-label="Remove line" className="text-text-tertiary hover:text-critical">
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </div>
            ))}
          </div>
          <Button size="sm" icon={<Plus />} className="mt-2" onClick={() => setLines((ls) => [...ls, newLine()])}>
            Add line
          </Button>
        </div>

        <FormGrid cols={2}>
          <TextField label="Carrier" hint="(optional)" value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Own truck, UPS…" />
          <TextField label="Tracking or trip reference" hint="(optional)" value={tracking} onChange={(e) => setTracking(e.target.value)} />
        </FormGrid>
        <TextArea label="Note" hint="(optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <Banner tone="critical">{error}</Banner>}
      </div>
    </Drawer>
  );
}
