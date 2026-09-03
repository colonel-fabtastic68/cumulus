"use client";

import { useState } from "react";
import type { Item } from "@/lib/types";
import { adjustStock } from "@/lib/inventory";
import { useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { fromDateInput, toDateInput, formatQty } from "@/lib/format";
import { Button, FormGrid, Modal, Segmented, Select, TextArea, TextField, useToast } from "@/components/ui";
import { ItemPicker } from "./ItemPicker";

type Mode = "count" | "add" | "remove";

const REASONS: Record<Mode, string[]> = {
  count: ["Cycle count", "Annual count", "Correction"],
  add: ["Found stock", "Correction", "Returned from job", "Other"],
  remove: ["Damaged", "Failed QC", "R&D / prototype", "Marketing / samples", "Lost or stolen", "Expired", "Correction", "Other"],
};

interface AdjustStockModalProps {
  open: boolean;
  onClose: () => void;
  item?: Item | null;
  onDone?: () => void;
}

/** Mounts the form only while open so every opening starts from a clean state. */
export function AdjustStockModal(props: AdjustStockModalProps) {
  if (!props.open) return null;
  return <AdjustStockForm {...props} />;
}

function AdjustStockForm({ open, onClose, item: fixedItem, onDone }: AdjustStockModalProps) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const [item, setItem] = useState<Item | null>(fixedItem ?? null);
  const [mode, setMode] = useState<Mode>("count");
  const [qty, setQty] = useState(fixedItem ? String(fixedItem.onHand) : "");
  const [reason, setReason] = useState(REASONS.count[0]!);
  const [note, setNote] = useState("");
  const [date, setDate] = useState(toDateInput());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeMode = (m: Mode) => {
    setMode(m);
    setReason(REASONS[m][0]!);
    setQty(m === "count" && item ? String(item.onHand) : "");
  };

  const qtyEmpty = qty.trim() === "";
  const n = qtyEmpty ? NaN : Number(qty);
  const delta = !item || !Number.isFinite(n) ? 0 : mode === "count" ? n - item.onHand : mode === "add" ? n : -n;
  const after = item ? item.onHand + delta : 0;
  const overdraw = !!item && mode === "remove" && Number.isFinite(n) && n > item.onHand;
  const futureDate = date > toDateInput();
  const canSave = !!item && !qtyEmpty && Number.isFinite(n) && n >= 0 && delta !== 0 && !overdraw && !futureDate;

  const submit = async () => {
    if (!item) return setError("Choose an item");
    if (qtyEmpty || !Number.isFinite(n) || n < 0) return setError("Enter a quantity");
    if (overdraw) return setError(`Only ${formatQty(item.onHand, item.unit)} on hand`);
    if (futureDate) return setError("The effective date cannot be in the future");
    if (delta === 0) return setError("Nothing to change");
    setBusy(true);
    setError(null);
    try {
      await adjustStock(store, user, [
        {
          itemId: item.id,
          ...(mode === "count" ? { newQty: n, type: "count" as const } : { qtyDelta: delta, type: mode === "remove" ? ("write_off" as const) : ("adjustment" as const) }),
          reason,
          note: note || undefined,
          occurredAt: fromDateInput(date),
        },
      ]);
      toast(`${item.sku}: ${delta > 0 ? "+" : ""}${delta} → ${after}`, "success");
      onDone?.();
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
      title={mode === "remove" ? "Write off stock" : "Adjust stock"}
      subtitle="Every change is recorded in the stock ledger with who, when and why."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={mode === "remove" ? "critical" : "primary"} onClick={submit} loading={busy} disabled={!canSave}>
            {mode === "remove" ? "Write off" : "Save adjustment"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ItemPicker label="Item" value={item} onChange={(i) => { setItem(i); if (i && mode === "count") setQty(String(i.onHand)); }} disabled={!!fixedItem} autoFocus={!fixedItem} />
        <Segmented
          value={mode}
          onChange={changeMode}
          options={[
            { value: "count", label: "Set count" },
            { value: "add", label: "Add" },
            { value: "remove", label: "Write off" },
          ]}
        />
        <FormGrid cols={2}>
          <TextField
            label={mode === "count" ? "Counted quantity" : "Quantity"}
            type="number"
            min={0}
            step="any"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            suffix={item?.unit !== "ea" ? item?.unit : undefined}
            autoFocus={!!fixedItem}
            error={overdraw && item ? `Only ${formatQty(item.onHand, item.unit)} on hand` : undefined}
          />
          <TextField label="Effective date" type="date" max={toDateInput()} value={date} onChange={(e) => setDate(e.target.value)} help="Back-date if the change happened earlier" error={futureDate ? "Cannot be in the future" : undefined} />
          <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} options={REASONS[mode].map((r) => ({ value: r, label: r }))} />
          <div className="rounded-[var(--radius-sm)] bg-surface-subdued px-3 py-2 text-[12.5px]">
            <div className="text-text-secondary">Result</div>
            {item ? (
              <div className="mt-0.5 font-medium tabular">
                {formatQty(item.onHand, item.unit)} → {formatQty(after, item.unit)}{" "}
                <span className={delta > 0 ? "text-success" : delta < 0 ? "text-critical" : "text-text-tertiary"}>
                  ({delta > 0 ? "+" : ""}
                  {delta})
                </span>
              </div>
            ) : (
              <div className="text-text-tertiary">Choose an item</div>
            )}
          </div>
        </FormGrid>
        <TextArea label="Note" hint="(optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>
    </Modal>
  );
}
