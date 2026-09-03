"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { Item } from "@/lib/types";
import { buildAssembly, buildableQty, explodeBom } from "@/lib/inventory";
import { useItems, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { formatQty, fromDateInput, toDateInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button, FormGrid, Modal, SimpleTable, TextField, Toggle, useToast } from "@/components/ui";
import { ItemPicker } from "./ItemPicker";

interface BuildModalProps {
  open: boolean;
  onClose: () => void;
  assembly?: Item | null;
  onDone?: () => void;
}

/** Mounts the form only while open so every opening starts from a clean state. */
export function BuildModal(props: BuildModalProps) {
  if (!props.open) return null;
  return <BuildForm {...props} />;
}

function BuildForm({ open, onClose, assembly: fixed, onDone }: BuildModalProps) {
  const store = useStore();
  const items = useItems();
  const user = useCurrentUser();
  const toast = useToast();
  const [assembly, setAssembly] = useState<Item | null>(fixed ?? null);
  const [qty, setQty] = useState("1");
  const [consumeSub, setConsumeSub] = useState(true);
  const [date, setDate] = useState(toDateInput());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const live = useMemo(() => (assembly ? items.find((i) => i.id === assembly.id) ?? assembly : null), [items, assembly]);
  const raw = Number(qty);
  const n = Number.isInteger(raw) && raw > 0 ? raw : 0;
  const badQty = qty.trim() !== "" && n === 0;
  const futureDate = date > toDateInput();
  const reqs = useMemo(() => (live && n > 0 ? explodeBom(items, live, n, { consumeSubassemblies: consumeSub, explodeShortfallOnly: !consumeSub }) : []), [items, live, n, consumeSub]);
  const shortages = reqs.filter((r) => r.shortage > 0);
  const canBuild = live ? buildableQty(items, live, { consumeSubassemblies: consumeSub, explodeShortfallOnly: !consumeSub }) : 0;
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const submit = async () => {
    if (!live) return setError("Choose an assembly");
    if (n <= 0) return setError("Enter a whole-number quantity");
    if (futureDate) return setError("The build date cannot be in the future");
    setBusy(true);
    setError(null);
    try {
      const b = await buildAssembly(store, user, { assemblyId: live.id, qty: n, consumeSubassemblies: consumeSub, note: note || undefined, occurredAt: fromDateInput(date) });
      toast(`Built ${n} × ${live.sku} (${b.number})`, "success");
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
      title="Build assembly"
      subtitle="Consumes components from stock and adds finished units to the shelf."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!live || n <= 0 || shortages.length > 0 || futureDate}>
            Build {n > 0 ? `${n} ×` : ""} {live?.sku ?? ""}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormGrid cols={3}>
          <div className="sm:col-span-2">
            <ItemPicker label="Assembly" value={live} onChange={setAssembly} filter={(i) => i.type === "assembly" && i.bom.length > 0 && i.status === "active"} disabled={!!fixed} autoFocus={!fixed} />
          </div>
          <TextField label="Quantity" type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} help={live ? `Can build ${canBuild} now` : undefined} error={badQty ? "Whole numbers only" : undefined} autoFocus={!!fixed} />
        </FormGrid>
        <FormGrid cols={2}>
          <TextField label="Build date" type="date" max={toDateInput()} value={date} onChange={(e) => setDate(e.target.value)} error={futureDate ? "Cannot be in the future" : undefined} />
          <TextField label="Note" hint="(optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </FormGrid>
        <div className="rounded-[var(--radius)] border border-border p-3">
          <Toggle
            label="Pull sub-assemblies from stock"
            help={consumeSub ? "Sub-assemblies on the BOM are taken from their own shelf stock." : "Sub-assemblies are exploded and built from base parts when stock runs out."}
            checked={consumeSub}
            onChange={setConsumeSub}
          />
        </div>
        {live && n > 0 && (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[12.5px]">
              <span className="font-medium">Components required</span>
              {shortages.length > 0 ? (
                <span className="inline-flex items-center gap-1 text-critical">
                  <AlertTriangle className="h-3.5 w-3.5" /> {shortages.length} short
                </span>
              ) : (
                <span className="text-success">All components available</span>
              )}
            </div>
            <SimpleTable>
              <thead>
                <tr>
                  <th>Component</th>
                  <th className="text-right">Required</th>
                  <th className="text-right">Available</th>
                  <th className="text-right">After</th>
                </tr>
              </thead>
              <tbody>
                {reqs.map((r) => (
                  <tr key={r.item.id} className={cn(r.shortage > 0 && "bg-critical-soft/50")}>
                    <td>
                      <span className={cn(r.depth > 0 && "pl-3 text-text-secondary")}>
                        <span className="font-mono text-[12px] text-text-secondary">{r.item.sku}</span> {byId.get(r.item.id)?.name ?? r.item.name}
                      </span>
                    </td>
                    <td className="text-right tabular">{formatQty(r.required, r.item.unit)}</td>
                    <td className="text-right tabular">{formatQty(r.available, r.item.unit)}</td>
                    <td className={cn("text-right tabular", r.shortage > 0 ? "font-medium text-critical" : "")}>{r.shortage > 0 ? `−${formatQty(r.shortage, r.item.unit)}` : formatQty(r.available - r.required, r.item.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </SimpleTable>
          </div>
        )}
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>
    </Modal>
  );
}
