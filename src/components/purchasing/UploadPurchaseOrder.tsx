"use client";

import { useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import Papa from "papaparse";
import { Eye, EyeOff, FileText, FileUp, Loader2, PenLine, Plus, Trash2, Undo2 } from "lucide-react";
import type { Item, PurchaseOrder } from "@/lib/types";
import { addUploadedPurchaseOrder, draftFromReading, MATCH_LABEL, purchaseOrderNumberTaken, readingFromSheet, sheetText, unitDiffers, type DraftLine, type PurchaseOrderDraft, type PurchaseOrderReading } from "@/lib/poUpload";
import { unitCostFor } from "@/lib/purchaseOrders";
import { supplierLinkFor } from "@/lib/suppliers";
import { isSpreadsheetFile, readSpreadsheet, SPREADSHEET_ACCEPT } from "@/lib/spreadsheet";
import { useCollection, useSettings, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { formatMoney, pluralize } from "@/lib/format";
import { cn, newId, round, sum } from "@/lib/utils";
import { useTerms } from "@/lib/useTerms";
import { Badge, Banner, Button, Checkbox, Combobox, ConfirmDialog, Drawer, FormGrid, IconButton, Skeleton, TextArea, TextField, useToast, type BadgeTone } from "@/components/ui";
import { ItemPicker } from "@/components/inventory";
import { shrinkImage, toBase64 } from "@/components/import/DocumentReader";
import { useStratoImportApi } from "@/components/import/api";
import { currencySymbol } from "./poUtils";

/** What the picker offers: a PDF, photos of the pages, or a sheet. */
const ACCEPT = `image/*,.pdf,application/pdf,.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain,${SPREADSHEET_ACCEPT}`;
/** The reader's function takes 4.5 MB; a PDF past this is refused before it is sent. */
const MAX_FILE_BYTES = 3_800_000;
const MAX_PAGES = 12;

const isImage = (f: File) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(f.name);
const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

type Preview = { kind: "image"; name: string; url: string } | { kind: "pdf"; name: string; url: string } | { kind: "sheet"; name: string; grid: string[][] } | { kind: "text"; name: string; text: string };

interface Source {
  id: string;
  name: string;
  previews: Preview[];
}

type Phase = { step: "reading"; source: Source; message: string } | { step: "failed"; source: Source; error: string } | { step: "review"; source: Source; draft: PurchaseOrderDraft; via: "sheet" | "strato" };

export interface UploadPurchaseOrderHandle {
  /** Opens the file picker; the review pane follows as soon as a file is chosen. */
  choose: () => void;
}

interface Props {
  ref?: Ref<UploadPurchaseOrderHandle>;
  onCreated?: (po: PurchaseOrder) => void;
  /** The person gave up on the upload and wants the blank form. */
  onManual: () => void;
}

/**
 * Upload a purchase order: the chosen document opens beside a review pane at
 * once, Strato (or the local sheet reader) fills the pane in, and nothing is
 * written until the person adds it.
 */
export function UploadPurchaseOrder({ ref, onCreated, onManual }: Props) {
  const api = useStratoImportApi();
  const toast = useToast();
  const items = useCollection("items");
  const suppliers = useCollection("suppliers");
  const settings = useSettings();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const choose = () => inputRef.current?.click();
  useImperativeHandle(ref, () => ({ choose: () => inputRef.current?.click() }), []);

  /** Stops a read in flight and frees the previews of the upload on screen. */
  const release = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    for (const p of phase?.source.previews ?? []) if (p.kind === "image" || p.kind === "pdf") URL.revokeObjectURL(p.url);
  };
  const close = () => {
    release();
    setConfirmDiscard(false);
    setPhase(null);
  };

  const begin = async (list: File[]) => {
    if (list.length === 0) return;
    const first = list[0]!;
    const media = list.some((f) => isImage(f) || isPdf(f));
    if (list.length > 1 && !list.every(isImage)) return toast("One order at a time: a single PDF or spreadsheet, or photos of the order's pages.", "critical");
    if (list.length > MAX_PAGES) return toast(`Up to ${MAX_PAGES} photos per order.`, "critical");
    const big = list.find((f) => !isImage(f) && f.size > MAX_FILE_BYTES);
    if (big) return toast(`${big.name} is over 3.8 MB. Export a smaller copy, or send photos of the pages.`, "critical");

    release();
    const ctl = new AbortController();
    abortRef.current = ctl;
    let source: Source = { id: newId("up"), name: list.length === 1 ? first.name : pluralize(list.length, "photo"), previews: media ? list.map((f): Preview => ({ kind: isPdf(f) ? "pdf" : "image", name: f.name, url: URL.createObjectURL(f) })) : [] };
    setPhase({ step: "reading", source, message: media ? "Strato is reading the order…" : "Reading the file…" });

    const ask = async (files: Array<{ name: string; mediaType: string; data?: string; text?: string }>) =>
      (await api<{ reading: PurchaseOrderReading }>("/api/purchase-orders/read", { files, company: settings.companyName, suppliers: suppliers.map((s) => s.name) }, { signal: ctl.signal })).reading;
    try {
      let reading: PurchaseOrderReading | null;
      let via: "sheet" | "strato" = "strato";
      if (media) {
        reading = await ask(await Promise.all(list.map(async (f) => (isPdf(f) ? { name: f.name, mediaType: "application/pdf", data: await toBase64(f) } : { name: f.name, ...(await shrinkImage(f)) }))));
      } else {
        let text = "";
        let grid: string[][];
        if (isSpreadsheetFile(first)) grid = (await readSpreadsheet(first)).rows;
        else {
          text = await first.text();
          grid = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" }).data.map((r) => r.map((c) => String(c ?? "").trim()));
        }
        const tabular = grid.length > 1 && grid.some((r) => r.length > 1);
        if (!tabular && !text.trim()) throw new Error("That file is empty.");
        source = { ...source, previews: [tabular ? { kind: "sheet", name: first.name, grid } : { kind: "text", name: first.name, text }] };
        // A sheet that already is a table of lines is read here, with no wait; anything else goes to Strato as text.
        reading = tabular ? readingFromSheet(grid) : null;
        if (reading) via = "sheet";
        else {
          setPhase({ step: "reading", source, message: "Strato is reading the order…" });
          reading = await ask([{ name: first.name, mediaType: "text/plain", text: tabular ? sheetText(grid) : text }]);
        }
      }
      if (ctl.signal.aborted) return;
      if (reading.lines.length === 0) throw new Error(reading.warnings[0] ?? "No order lines were found in that. Try a clearer copy, or enter the order manually.");
      setPhase({ step: "review", source, draft: draftFromReading(reading, { items, suppliers, currency: settings.currency }), via });
    } catch (e) {
      if (ctl.signal.aborted) return;
      setPhase({ step: "failed", source, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const title = phase?.step === "review" ? "Review purchase order" : phase?.step === "failed" ? "Could not read the order" : "Reading purchase order";
  const subtitle = phase ? `${phase.source.name}${phase.step === "review" ? (phase.via === "strato" ? " · read by Strato" : " · read from the sheet") : ""}. Nothing is saved until you add it.` : undefined;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          e.target.value = "";
          void begin(list);
        }}
      />
      {/* Checked work is not thrown away by a stray click outside the pane. */}
      <Drawer open={!!phase} onClose={() => (phase?.step === "review" ? setConfirmDiscard(true) : close())} width={1240} title={title} subtitle={subtitle}>
        {phase?.step === "reading" && (
          <Split source={phase.source} footer={<Button onClick={close}>Cancel</Button>}>
            <div className="flex flex-col gap-4" aria-busy="true">
              <div className="flex items-center gap-2 text-[13px] text-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin text-magic" />
                <span aria-live="polite">{phase.message}</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Skeleton className="col-span-2 h-8" />
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
              <div className="flex flex-col gap-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            </div>
          </Split>
        )}
        {phase?.step === "failed" && (
          <Split source={phase.source} footer={<Button onClick={close}>Close</Button>}>
            <Banner
              tone="critical"
              title="Nothing was added"
              action={
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" icon={<FileUp />} onClick={choose}>
                    Choose another file
                  </Button>
                  <Button
                    size="sm"
                    icon={<PenLine />}
                    onClick={() => {
                      close();
                      onManual();
                    }}
                  >
                    Enter manually
                  </Button>
                </div>
              }
            >
              {phase.error}
            </Banner>
          </Split>
        )}
        {phase?.step === "review" && (
          <Review
            key={phase.source.id}
            source={phase.source}
            draft={phase.draft}
            onCancel={() => setConfirmDiscard(true)}
            onAdded={(po) => {
              close();
              onCreated?.(po);
            }}
          />
        )}
      </Drawer>
      <ConfirmDialog open={confirmDiscard} onClose={() => setConfirmDiscard(false)} onConfirm={close} destructive title="Discard this upload?" confirmLabel="Discard" message={<>The order has not been added. The document stays where it is; you can upload it again.</>} />
    </>
  );
}

// ---- layout: the document on the left, the pane's content on the right ---------

function Split({ source, children, footer }: { source: Source; children: ReactNode; footer: ReactNode }) {
  const [showDoc, setShowDoc] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-4 overflow-y-auto lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-5 lg:overflow-visible">
        <div className={cn("min-w-0 lg:block lg:min-h-0", showDoc ? "h-[60vh] lg:h-auto" : "hidden")}>
          <DocumentPreview source={source} />
        </div>
        <div className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          <button type="button" onClick={() => setShowDoc((v) => !v)} className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-accent hover:underline lg:hidden">
            {showDoc ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showDoc ? "Hide the document" : "Show the document"}
          </button>
          {children}
        </div>
      </div>
      <div className="-mx-5 -mb-4 mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>
    </div>
  );
}

function DocumentPreview({ source }: { source: Source }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-surface-subdued">
      <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-1.5 text-[12px] text-text-secondary">
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{source.name}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {source.previews.length === 0 && <Skeleton className="m-3 h-40" />}
        {source.previews.map((p, i) =>
          p.kind === "pdf" ? (
            // The viewer's own toolbar and page list would take half the column; the page is fitted to the width instead.
            <iframe key={i} src={`${p.url}#toolbar=0&navpanes=0&view=FitH`} title={p.name} className="h-full w-full bg-surface" />
          ) : p.kind === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={i} src={p.url} alt={p.name} className="w-full border-b border-border last:border-b-0" />
          ) : p.kind === "sheet" ? (
            <table key={i} className="w-full border-collapse bg-surface text-[12px]">
              <tbody>
                {p.grid.slice(0, 300).map((row, r) => (
                  <tr key={r} className={cn("border-b border-border", r === 0 && "bg-surface-subdued font-medium text-text-secondary")}>
                    {row.map((cell, c) => (
                      <td key={c} className="whitespace-nowrap px-2 py-1">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <pre key={i} className="whitespace-pre-wrap bg-surface p-3 text-[12px] text-text">
              {p.text.slice(0, 20_000)}
            </pre>
          ),
        )}
      </div>
    </div>
  );
}

// ---- the review pane -----------------------------------------------------------

interface LineState {
  key: string;
  src: DraftLine;
  /** item: an item in the catalog. new: one created with the order. */
  mode: "item" | "new";
  item: Item | null;
  /** A person chose the item (the reader's own matches are not "picked"). */
  picked: boolean;
  newSku: string;
  newName: string;
  qty: string;
  unitCost: string;
  /** The cost is the document's (or was typed), so a change of supplier or item does not replace it. */
  costFromDoc: boolean;
  removed: boolean;
}

const sameCode = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function Review({ source, draft, onCancel, onAdded }: { source: Source; draft: PurchaseOrderDraft; onCancel: () => void; onAdded: (po: PurchaseOrder) => void }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const suppliers = useCollection("suppliers");
  const purchaseOrders = useCollection("purchaseOrders");
  const allItems = useCollection("items");
  const { currency } = useSettings();
  const symbol = currencySymbol(currency);
  const itemTerms = useTerms();

  const [supplier, setSupplier] = useState(draft.supplierName);
  const supplierRecord = useMemo(() => suppliers.find((s) => s.name.toLowerCase() === supplier.trim().toLowerCase()), [suppliers, supplier]);
  const [number, setNumber] = useState(draft.number);
  const [expectedAt, setExpectedAt] = useState(draft.expectedAt);
  const [terms, setTerms] = useState(draft.terms);
  const [reference, setReference] = useState(draft.reference);
  const [note, setNote] = useState(draft.note);
  const [send, setSend] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<LineState[]>(() =>
    draft.lines.map((d) => ({
      key: newId("ln"),
      src: d,
      mode: "item",
      item: d.item ?? null,
      picked: false,
      newSku: (d.codes[0] ?? "").toUpperCase(),
      newName: d.description,
      qty: d.qty !== undefined ? String(d.qty) : "",
      unitCost: d.unitCost !== undefined ? String(d.unitCost) : d.item ? String(unitCostFor(d.item, draft.supplier?.id)) : "",
      costFromDoc: d.unitCost !== undefined,
      removed: false,
    })),
  );

  const takenSkus = useMemo(() => new Set(allItems.map((i) => i.sku.toUpperCase())), [allItems]);
  const supplierOptions = useMemo(() => [...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ value: s.name, label: s.name, description: [s.terms, s.leadTimeDays ? `${s.leadTimeDays} day lead time` : ""].filter(Boolean).join(" · ") || undefined })), [suppliers]);

  // Picking a known supplier fills in its terms and re-prices lines the document gave no cost for.
  const onSupplierChange = (value: string) => {
    setSupplier(value);
    const known = suppliers.find((s) => s.name.toLowerCase() === value.trim().toLowerCase());
    if (known?.terms && !terms) setTerms(known.terms);
    setLines((prev) => prev.map((l) => (l.item && !l.costFromDoc ? { ...l, unitCost: String(unitCostFor(l.item, known?.id)) } : l)));
  };
  const patchLine = (key: string, fn: (l: LineState) => LineState) => setLines((prev) => prev.map((l) => (l.key === key ? fn(l) : l)));
  const setItem = (key: string, item: Item | null) => patchLine(key, (l) => ({ ...l, mode: "item", item, picked: !!item, unitCost: item && !l.costFromDoc ? String(unitCostFor(item, supplierRecord?.id)) : l.unitCost }));

  const check = (l: LineState, i: number) => {
    const qty = Number(l.qty);
    const cost = Number(l.unitCost);
    const qtyOk = l.qty.trim() !== "" && Number.isFinite(qty) && qty > 0;
    const costOk = l.unitCost.trim() !== "" && Number.isFinite(cost) && cost >= 0;
    const sku = l.newSku.trim().toUpperCase();
    const skuClash = l.mode === "new" && !!sku && (takenSkus.has(sku) || lines.some((o, j) => j < i && !o.removed && o.mode === "new" && o.newSku.trim().toUpperCase() === sku));
    const itemOk = l.mode === "item" ? !!l.item : !!sku && !!l.newName.trim() && !skuClash;
    return { qty, cost, qtyOk, costOk, skuClash, itemOk, ready: itemOk && qtyOk && costOk, total: qtyOk && costOk ? round(qty * cost) : 0 };
  };
  const active = lines.map((l, i) => ({ l, c: check(l, i) })).filter((x) => !x.l.removed);
  const pending = active.filter((x) => !x.c.ready);
  const total = round(sum(active.map((x) => x.c.total)));
  const newItems = active.filter((x) => x.l.mode === "new").length;
  const matched = active.filter((x) => x.l.mode === "item" && x.l.item && !x.l.picked).length;
  const byHand = active.filter((x) => x.l.mode === "item" && x.l.item && x.l.picked).length;
  /** Lines a person matched whose printed part number is not on file for this supplier yet. */
  const rememberable = active.filter((x) => x.l.mode === "item" && x.l.item && x.l.picked && x.l.src.codes[0] && !sameCode(x.l.src.codes[0], x.l.item.sku) && !(supplierRecord && supplierLinkFor(x.l.item, supplierRecord.id)?.supplierSku));
  const numberTaken = purchaseOrderNumberTaken(purchaseOrders, number);
  const docTotal = draft.documentLinesTotal;
  const totalOff = docTotal !== undefined && pending.length === 0 && Math.abs(docTotal - total) > 0.005 ? round(total - docTotal) : 0;
  const canAdd = active.length > 0 && pending.length === 0 && !!supplier.trim() && !numberTaken;

  const submit = async () => {
    if (!canAdd) return;
    setBusy(true);
    setError(null);
    try {
      const { po, createdItems, createdSupplier, remembered } = await addUploadedPurchaseOrder(store, user, {
        supplierId: supplierRecord?.id,
        supplier: supplier.trim(),
        number: number.trim() || undefined,
        expectedAt,
        terms,
        reference,
        note,
        send,
        lines: active.map(({ l, c }) =>
          l.mode === "new"
            ? { newItem: { sku: l.newSku, name: l.newName, unit: l.src.unit, supplierSku: l.src.codes.find((code) => !sameCode(code, l.newSku)) }, qty: c.qty, unitCost: c.cost }
            : { itemId: l.item!.id, qty: c.qty, unitCost: c.cost, rememberCode: remember && l.picked ? l.src.codes[0] : undefined },
        ),
      });
      const extras = [createdSupplier ? "a new supplier" : "", createdItems.length ? pluralize(createdItems.length, "new item") : "", remembered ? `${pluralize(remembered, "part number")} remembered` : ""].filter(Boolean);
      toast(`${send ? "Sent" : "Added"} ${po.number} to ${po.supplier}${extras.length ? ` · ${extras.join(", ")}` : ""}`, "success");
      onAdded(po);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg, "critical");
      setBusy(false);
    }
  };

  const footer = (
    <>
      <div className="mr-auto min-w-0 text-[12.5px] text-text-secondary">
        <span className="font-medium text-text">{pluralize(active.length, "line")}</span> · <span className="font-medium tabular text-text">{formatMoney(total, currency)}</span>
        {pending.length > 0 && <span className="text-warning"> · {pluralize(pending.length, "line")} to settle first</span>}
        {numberTaken && <span className="text-critical"> · the PO number is already used</span>}
        {!supplier.trim() && <span className="text-warning"> · choose a supplier</span>}
        {error && <span className="text-critical"> · {error}</span>}
      </div>
      <Button onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!canAdd}>
        {send ? "Add and mark sent" : "Add purchase order"}
      </Button>
    </>
  );

  return (
    <Split source={source} footer={footer}>
      <div className="flex flex-col gap-4">
        {pending.length > 0 ? (
          <Banner tone="warning" title={`${pluralize(pending.length, "line")} of ${active.length} ${pending.length === 1 ? "needs" : "need"} a look`}>
            Pick the item, add it as a new one, or leave the line off. The order can be added once every line is settled.
          </Banner>
        ) : (
          <Banner tone="success" title={`${pluralize(active.length, "line")} ready`}>
            {[matched ? `${matched} matched by part number` : "", byHand ? `${byHand} set by hand` : "", newItems ? `${newItems} new` : ""].filter(Boolean).join(", ")}. Check the numbers against the document, then add the order.
          </Banner>
        )}
        {draft.warnings.length > 0 && (
          <Banner tone="info" title="Worth checking against the document">
            <ul className="list-disc pl-4">
              {draft.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Banner>
        )}

        <FormGrid cols={3}>
          <div className="sm:col-span-2">
            <Combobox label="Supplier" value={supplier} onChange={onSupplierChange} onCreate={onSupplierChange} createLabel={(q) => `Use “${q}” as a new supplier`} placeholder="Type a supplier name" options={supplierOptions} />
            <p className="mt-1 text-[12px] text-text-tertiary">
              {!supplier.trim() ? <span className="text-warning">The document does not name a supplier. Choose one.</span> : supplierRecord ? (draft.printedSupplier && !sameCode(draft.printedSupplier, supplierRecord.name) ? `On file. Printed as “${draft.printedSupplier}”.` : "On file.") : "Not on file yet. It is added as a supplier with the order."}
            </p>
          </div>
          <TextField label="PO number" hint="(optional)" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Next PO number" error={numberTaken ? `${number.trim()} is already a purchase order here.` : undefined} help={draft.number && sameCode(draft.number, number) ? "As printed on the document." : "Leave blank for the next PO-xxxx."} />
        </FormGrid>
        <FormGrid cols={3}>
          <TextField label="Expected" hint="(optional)" type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} help={supplierRecord?.leadTimeDays ? `${supplierRecord.name} usually takes ${supplierRecord.leadTimeDays} days` : undefined} />
          <TextField label="Terms" hint="(optional)" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Net 30" />
          <TextField label="Supplier reference" hint="(optional)" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Quote or confirmation #" />
        </FormGrid>

        <div>
          <div className="mb-1.5 text-[12.5px] font-medium text-text">Lines</div>
          <ul className="rounded-[var(--radius)] border border-border">
            {lines.map((l, i) => {
              const c = check(l, i);
              const printed = [l.src.codes.join(" · "), l.src.description].filter(Boolean).join("  ");
              if (l.removed)
                return (
                  <li key={l.key} className="flex items-center justify-between gap-3 border-b border-border bg-surface-subdued px-3 py-2 text-[12.5px] text-text-tertiary">
                    <span className="min-w-0 truncate line-through">{printed || "Line"}</span>
                    <Button size="sm" variant="plain" icon={<Undo2 />} onClick={() => patchLine(l.key, (x) => ({ ...x, removed: false }))}>
                      Put back
                    </Button>
                  </li>
                );
              const status: { tone: BadgeTone; label: string } = !c.itemOk
                ? l.mode === "new"
                  ? c.skuClash
                    ? { tone: "critical", label: `${itemTerms.itemCodeShort} already exists` }
                    : { tone: "warning", label: `Needs a ${itemTerms.itemCodeShort} and name` }
                  : { tone: "warning", label: "Needs an item" }
                : !c.qtyOk
                  ? { tone: "warning", label: "Needs a quantity" }
                  : !c.costOk
                    ? { tone: "warning", label: "Needs a unit cost" }
                    : l.mode === "new"
                      ? { tone: "info", label: "New item" }
                      : l.picked
                        ? { tone: "success", label: "Set by hand" }
                        : { tone: "success", label: "Matched" };
              const onFile = l.item ? unitCostFor(l.item, supplierRecord?.id) : undefined;
              const sameItemEarlier = !!l.item && lines.some((o, j) => j < i && !o.removed && o.item?.id === l.item!.id);
              return (
                <li key={l.key} className="border-b border-border px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 text-[12.5px] leading-5">
                      {l.src.codes.length > 0 && <span className="font-mono text-text">{l.src.codes.join(" · ")}</span>}
                      {l.src.codes.length > 0 && l.src.description && " "}
                      <span className="text-text-secondary">{l.src.description}</span>
                      {!printed && <span className="text-text-tertiary">No part number or description on this line</span>}
                    </p>
                    <Badge tone={status.tone} className="mt-0.5 shrink-0">
                      {status.label}
                    </Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_72px_108px_84px_32px] sm:items-start">
                    {l.mode === "item" ? (
                      <ItemPicker value={l.item} onChange={(item) => setItem(l.key, item)} filter={(it) => it.status === "active"} placeholder={`Search ${itemTerms.itemCodeShort} or name`} />
                    ) : (
                      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
                        <TextField value={l.newSku} onChange={(e) => patchLine(l.key, (x) => ({ ...x, newSku: e.target.value.toUpperCase() }))} aria-label={`New ${itemTerms.itemCodeShort}`} placeholder={itemTerms.itemCodeShort} className="font-mono" error={c.skuClash ? "In use" : undefined} />
                        <TextField value={l.newName} onChange={(e) => patchLine(l.key, (x) => ({ ...x, newName: e.target.value }))} aria-label="New item name" placeholder="Name" />
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-2 sm:contents">
                      <TextField type="number" min={0} step="any" value={l.qty} onChange={(e) => patchLine(l.key, (x) => ({ ...x, qty: e.target.value }))} aria-label="Quantity" className="text-right" />
                      <TextField type="number" min={0} step="any" prefix={symbol} value={l.unitCost} onChange={(e) => patchLine(l.key, (x) => ({ ...x, unitCost: e.target.value, costFromDoc: true }))} aria-label="Unit cost" className="text-right" />
                      <div className={cn("flex h-8 items-center justify-end text-[13px] tabular", c.qtyOk && c.costOk ? "text-text" : "text-text-tertiary")}>{c.qtyOk && c.costOk ? formatMoney(c.total, currency) : "—"}</div>
                    </div>
                    <div className="flex justify-end sm:justify-center">
                      <IconButton variant="plain" size="md" onClick={() => patchLine(l.key, (x) => ({ ...x, removed: true }))} aria-label="Leave this line off" title="Leave this line off" className="text-text-tertiary hover:text-critical">
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-col gap-1 text-[12px] text-text-tertiary">
                    {l.mode === "item" && l.item && !l.picked && l.src.matchedBy && (
                      <span>
                        Matched by {l.src.matchedBy === "sku" ? itemTerms.itemCodeShort : MATCH_LABEL[l.src.matchedBy]} {l.src.matchedCode}.
                      </span>
                    )}
                    {l.mode === "item" && !l.item && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-warning">{l.src.retired ? `${l.src.retired.sku} is ${l.src.retired.status}, so it cannot be ordered. Pick its replacement.` : l.src.codes.length ? "No item has this part number." : "Nothing to match this line by."}</span>
                        {l.src.suggestion && (
                          <Button size="sm" variant="plain" className="max-w-full" onClick={() => setItem(l.key, l.src.suggestion!)}>
                            <span className="truncate">
                              Use {l.src.suggestion.sku} · {l.src.suggestion.name}
                            </span>
                          </Button>
                        )}
                        <Button size="sm" variant="plain" icon={<Plus />} onClick={() => patchLine(l.key, (x) => ({ ...x, mode: "new", item: null, picked: false }))}>
                          Add as a new item
                        </Button>
                      </div>
                    )}
                    {l.mode === "new" && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>Created with the order, bought from {supplier.trim() || "this supplier"}.</span>
                        <Button size="sm" variant="plain" onClick={() => patchLine(l.key, (x) => ({ ...x, mode: "item" }))}>
                          Pick an existing item instead
                        </Button>
                      </div>
                    )}
                    {l.item && unitDiffers(l.src.unit, l.item) && (
                      <span className="text-warning">
                        The document counts this by the {l.src.unit}; {l.item.sku} is stocked by the {l.item.unit}. Enter the quantity in {l.item.unit}.
                      </span>
                    )}
                    {sameItemEarlier && <span>Same item as a line above. The quantities are added together on the order.</span>}
                    {l.src.costFrom === "lineTotal" && sameCode(l.unitCost, String(l.src.unitCost)) && <span>Unit cost worked out from the document&apos;s line total.</span>}
                    {l.src.costFrom === "none" && !l.costFromDoc && l.item && <span>No cost on the document. Using the cost on file.</span>}
                    {l.costFromDoc && c.costOk && onFile !== undefined && Math.abs(onFile - c.cost) > 0.005 && <span>Cost on file is {formatMoney(onFile, currency)}.</span>}
                    {l.src.lineTotal !== undefined && c.qtyOk && c.costOk && Math.abs(l.src.lineTotal - c.total) > 0.01 && <span className="text-warning">The document&apos;s total for this line is {formatMoney(l.src.lineTotal, currency)}.</span>}
                  </div>
                </li>
              );
            })}
            <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-surface-subdued px-3 py-2 text-[13px]">
              <span className="text-text-secondary">
                {pluralize(active.length, "line")}
                {lines.length > active.length ? ` · ${lines.length - active.length} left off` : ""}
              </span>
              <span className="flex flex-wrap items-center gap-x-3">
                {docTotal !== undefined && <span className={cn("text-[12.5px]", totalOff ? "text-warning" : "text-text-secondary")}>{totalOff ? `Document says ${formatMoney(docTotal, currency)}: ${formatMoney(Math.abs(totalOff), currency)} ${totalOff > 0 ? "less than" : "more than"} these lines` : `Document says ${formatMoney(docTotal, currency)}`}</span>}
                <span className="font-semibold tabular">{formatMoney(total, currency)}</span>
              </span>
            </li>
          </ul>
        </div>

        <TextArea label="Note" hint="(optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Printed on the order: delivery instructions, split shipments, etc." />
        {rememberable.length > 0 && (
          <Checkbox
            label={`Remember ${rememberable.length === 1 ? "this part number" : `these ${rememberable.length} part numbers`} for ${supplier.trim() || "this supplier"}`}
            help={`${rememberable[0]!.l.src.codes[0]} is saved on ${rememberable[0]!.l.item!.sku} as the supplier's part number, so their next document matches on its own.`}
            checked={remember}
            onChange={setRemember}
          />
        )}
        <Checkbox label="Mark as sent" help="This order has already gone to the supplier. Drafts stay editable." checked={send} onChange={setSend} />
      </div>
    </Split>
  );
}
