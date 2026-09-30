"use client";

import { useMemo, useRef, useState } from "react";
import { Camera, Check, ClipboardCheck, Printer } from "lucide-react";
import type { Receipt } from "@/lib/types";
import { checklistDifferences, checklistRowsFor, completeChecklist, printReceivingChecklist, saveChecklist } from "@/lib/receivingChecklist";
import { useItemsById, useSettings, useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { formatDateTime, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Banner, Button, Checkbox, ConfirmDialog, TextField, useToast } from "@/components/ui";
import type { ReceiptLookups } from "./receiptUtils";

interface ScanLine {
  sku: string;
  checked: boolean | null;
  found: number | null;
  confidence: "high" | "medium" | "low";
  note: string | null;
}

/**
 * The put-away checklist on a receipt: tick lines off, note what was actually
 * found, print a sheet for the floor, or read a photo of the filled-in sheet.
 */
export function ReceiptChecklist({ receipt, lookups }: { receipt: Receipt; lookups: ReceiptLookups }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const itemsById = useItemsById();
  const settings = useSettings();
  const writable = canWrite(user) && receipt.status === "received";
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "scan" | "complete" | null>(null);
  const [scan, setScan] = useState<{ lines: ScanLine[]; remarks: string | null } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const done = !!receipt.checklist?.completedAt;
  const ticked = receipt.lines.filter((l) => l.checked).length;
  const diffs = useMemo(() => checklistDifferences(receipt), [receipt]);

  const tick = async (itemId: string, checked: boolean) => {
    try {
      await saveChecklist(store, user, receipt.id, [{ itemId, checked }]);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    }
  };
  const saveFound = async (itemId: string) => {
    const raw = drafts[itemId];
    if (raw === undefined) return;
    const found = raw.trim() === "" ? null : Number(raw);
    if (found !== null && (!Number.isFinite(found) || found < 0)) return;
    try {
      await saveChecklist(store, user, receipt.id, [{ itemId, found }]);
      setDrafts((d) => {
        const n = { ...d };
        delete n[itemId];
        return n;
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    }
  };
  const tickAll = async () => {
    setBusy("save");
    try {
      await saveChecklist(store, user, receipt.id, receipt.lines.map((l) => ({ itemId: l.itemId, checked: true })));
    } finally {
      setBusy(null);
    }
  };

  const print = () => {
    if (!printReceivingChecklist({ title: `Receiving checklist ${receipt.number}`, subtitle: [lookups.suppliersById.get(receipt.supplierId ?? "")?.name, receipt.reference].filter(Boolean).join(" · ") || receipt.number, rows: checklistRowsFor(receipt, itemsById), companyName: settings.companyName, blankQty: true })) toast("Allow pop-ups to print the checklist", "critical");
  };

  const readPhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy("scan");
    setScan(null);
    try {
      const image = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Could not read the photo"));
        r.readAsDataURL(file);
      });
      const res = await fetch("/api/receiving/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image, lines: checklistRowsFor(receipt, itemsById).map((r) => ({ sku: r.sku, name: r.name, qty: r.qty })) }) });
      const data = (await res.json().catch(() => ({}))) as { lines?: ScanLine[]; remarks?: string | null; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not read the photo.");
      setScan({ lines: data.lines ?? [], remarks: data.remarks ?? null });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const applyScan = async () => {
    if (!scan) return;
    const bySku = new Map(receipt.lines.map((l) => [itemsById.get(l.itemId)?.sku.toUpperCase() ?? l.itemId, l.itemId]));
    const entries = scan.lines.flatMap((s) => {
      const itemId = bySku.get(s.sku.toUpperCase());
      if (!itemId) return [];
      return [{ itemId, ...(s.checked !== null ? { checked: s.checked } : {}), ...(s.found !== null ? { found: s.found } : {}) }];
    });
    setBusy("save");
    try {
      await saveChecklist(store, user, receipt.id, entries);
      toast(`Applied ${pluralize(entries.length, "line")} from the photo`, "success");
      setScan(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(null);
    }
  };

  const complete = async (adjust: boolean) => {
    setBusy("complete");
    try {
      const r = await completeChecklist(store, user, receipt.id, { adjust, source: scan ? "photo" : "manual" });
      toast(adjust && r.adjusted ? `Checklist done · ${pluralize(r.adjusted, "adjustment")} booked` : "Checklist done", "success");
      setConfirm(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-[var(--radius)] border border-border">
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-subdued px-3 py-2">
        <ClipboardCheck className="h-4 w-4 text-icon" />
        <span className="text-[13px] font-semibold text-text">Put-away checklist</span>
        <span className="text-[12.5px] text-text-secondary">
          {ticked} of {receipt.lines.length} ticked
          {diffs.length ? ` · ${pluralize(diffs.length, "difference")}` : ""}
        </span>
        {done && <Badge tone="success">Done {formatDateTime(receipt.checklist!.completedAt!)}</Badge>}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <Button size="sm" icon={<Printer />} onClick={print}>
            Print sheet
          </Button>
          {writable && !done && (
            <>
              <Button size="sm" icon={<Camera />} onClick={() => fileRef.current?.click()} loading={busy === "scan"} disabled={busy !== null}>
                Read a photo
              </Button>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void readPhoto(e.target.files?.[0])} />
              <Button size="sm" variant="plain" onClick={() => void tickAll()} disabled={busy !== null || ticked === receipt.lines.length}>
                Tick all
              </Button>
              <Button size="sm" variant="primary" icon={<Check />} onClick={() => setConfirm(true)} disabled={busy !== null || ticked === 0}>
                Mark done
              </Button>
            </>
          )}
        </div>
      </div>
      {scan && (
        <div className="border-b border-border bg-accent-soft/40 px-3 py-2 text-[12.5px]">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-text">Read from the photo: {scan.lines.length} rows</span>
            {scan.remarks && <span className="text-text-secondary">{scan.remarks}</span>}
            <div className="ml-auto flex gap-1.5">
              <Button size="sm" variant="plain" onClick={() => setScan(null)}>
                Discard
              </Button>
              <Button size="sm" variant="primary" onClick={() => void applyScan()} loading={busy === "save"}>
                Apply to checklist
              </Button>
            </div>
          </div>
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-text-secondary">
            {scan.lines.map((s) => (
              <li key={s.sku}>
                <span className="font-mono text-text">{s.sku}</span> {s.checked ? "✓" : s.checked === false ? "☐" : "?"} {s.found !== null ? `found ${s.found}` : "no quantity"}
                {s.confidence !== "high" && <span className="ml-1 text-warning">({s.confidence})</span>}
                {s.note && <span className="ml-1 italic">“{s.note}”</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="divide-y divide-border">
        {receipt.lines.map((l) => {
          const item = itemsById.get(l.itemId);
          const found = drafts[l.itemId] ?? (l.found === undefined ? "" : String(l.found));
          const differs = l.found !== undefined && Math.abs(l.found - l.qty) > 1e-9;
          return (
            <li key={l.itemId} className={cn("flex flex-wrap items-center gap-3 px-3 py-1.5 text-[13px]", l.checked && "bg-success-soft/30")}>
              <Checkbox checked={!!l.checked} onChange={(v) => void tick(l.itemId, v)} disabled={!writable || done} label={<span className="font-mono">{item?.sku ?? l.itemId}</span>} />
              <span className="min-w-0 flex-1 truncate text-text-secondary">{item?.name}</span>
              <span className="tabular text-text-secondary">expected {l.qty}</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] text-text-tertiary">found</span>
                <TextField type="number" min={0} step="any" value={found} onChange={(e) => setDrafts((d) => ({ ...d, [l.itemId]: e.target.value }))} onBlur={() => void saveFound(l.itemId)} onKeyDown={(e) => e.key === "Enter" && void saveFound(l.itemId)} placeholder={String(l.qty)} containerClassName="w-20" className={cn("text-right", differs && "border-warning")} disabled={!writable || done} aria-label={`Found quantity for ${item?.sku ?? l.itemId}`} />
              </div>
              {differs && <Badge tone="warning">{l.found! > l.qty ? "+" : ""}{Math.round((l.found! - l.qty) * 10000) / 10000}</Badge>}
            </li>
          );
        })}
      </ul>
      {done && receipt.checklist?.adjusted ? <div className="border-t border-border px-3 py-1.5 text-[12px] text-text-tertiary">{pluralize(receipt.checklist.adjusted, "adjustment")} booked for lines that did not match.</div> : null}
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => complete(diffs.length > 0)}
        loading={busy === "complete"}
        confirmLabel={diffs.length ? "Mark done and adjust stock" : "Mark done"}
        title={`Finish the checklist for ${receipt.number}?`}
        message={
          diffs.length ? (
            <span>
              {pluralize(diffs.length, "line")} found a different quantity than the receipt booked: {diffs.map((d) => `${itemsById.get(d.line.itemId)?.sku ?? d.line.itemId} ${d.delta > 0 ? "+" : ""}${d.delta}`).join(", ")}. Stock will be adjusted by those differences so the shelf and the ledger agree; the receipt itself stays as recorded.
            </span>
          ) : (
            <span>{ticked} of {receipt.lines.length} lines are ticked and every found quantity matches. Nothing changes in stock.</span>
          )
        }
      />
      {!writable && !done && receipt.status === "received" && <Banner tone="info" className="m-3">Viewers can read the checklist but not tick it.</Banner>}
    </div>
  );
}
