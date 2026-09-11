"use client";

import { useMemo, useState } from "react";
import { Check, FileDown, Plus, Printer, Send, ShoppingCart, Sparkles, Trash2, XCircle } from "lucide-react";
import type { Item, Quote, QuoteLine, QuoteLineKind } from "@/lib/types";
import { createQuote, defaultValidUntil, deleteQuote, isQuoteExpired, itemLine, laborLine, lineTotal, linesFromDraft, newQuoteLine, quoteHtml, quoteShortages, quoteTotals, quotingSettings, setQuoteStatus, updateQuote, type QuoteDraft } from "@/lib/quotes";
import { useItems, useItemsById, useSettings, useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { formatMoney, formatQty, pluralize } from "@/lib/format";
import { cn, round } from "@/lib/utils";
import { Badge, Banner, Button, ConfirmDialog, Drawer, FormGrid, IconButton, Select, TextArea, TextField, useToast } from "@/components/ui";
import { ItemPicker } from "@/components/inventory";
import { downloadCsv } from "@/components/reports/csv";
import { QuoteStatusBadge } from "./QuotesTable";

const KIND_OPTIONS: Array<{ value: QuoteLineKind; label: string }> = [
  { value: "item", label: "Item" },
  { value: "labor", label: "Labour" },
  { value: "other", label: "Other" },
];

interface QuoteEditorProps {
  open: boolean;
  quote: Quote | null;
  onClose: () => void;
  onSaved?: (q: Quote) => void;
}

/** New or existing quote in a drawer; mounts fresh per quote so state never leaks between them. */
export function QuoteEditor({ open, quote, onClose, onSaved }: QuoteEditorProps) {
  if (!open) return null;
  return <Editor key={quote?.id ?? "new"} quote={quote} onClose={onClose} onSaved={onSaved} />;
}

function Editor({ quote, onClose, onSaved }: Omit<QuoteEditorProps, "open">) {
  const store = useStore();
  const user = useCurrentUser();
  const writable = canWrite(user);
  const settings = useSettings();
  const quoting = quotingSettings(settings);
  const items = useItems();
  const byId = useItemsById();
  const toast = useToast();
  const { open: openAgent } = useAgent();
  const currency = quote?.currency ?? settings.currency;

  const [customer, setCustomer] = useState(quote?.customer ?? "");
  const [email, setEmail] = useState(quote?.customerEmail ?? "");
  const [validUntil, setValidUntil] = useState(quote?.validUntil ?? defaultValidUntil(quoting));
  const [discountPct, setDiscountPct] = useState(String(quote?.discountPct ?? ""));
  const [taxPct, setTaxPct] = useState(String(quote?.taxPct ?? quoting.taxPct ?? ""));
  const [notes, setNotes] = useState(quote?.notes ?? "");
  const [terms, setTerms] = useState(quote?.terms ?? quoting.terms ?? "");
  const [lines, setLines] = useState<QuoteLine[]>(quote?.lines ?? []);
  const [prompt, setPrompt] = useState(quote?.sourcePrompt ?? "");
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<{ tone: "info" | "critical"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"delete" | "accept" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const draft = { lines, discountPct: Number(discountPct) || 0, taxPct: Number(taxPct) || 0 };
  const totals = useMemo(() => quoteTotals(draft), [lines, discountPct, taxPct]); // eslint-disable-line react-hooks/exhaustive-deps
  const shortages = useMemo(() => quoteShortages(draft, byId), [lines, byId]); // eslint-disable-line react-hooks/exhaustive-deps
  const locked = !!quote && (quote.status === "accepted" || quote.status === "declined");
  const editable = writable && !locked;

  const patch = (id: string, p: Partial<QuoteLine>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const remove = (id: string) => setLines((ls) => ls.filter((l) => l.id !== id));
  const addLine = (kind: QuoteLineKind) => setLines((ls) => [...ls, kind === "labor" ? laborLine(1, quoting) : newQuoteLine({ kind, description: "", qty: 1, unitPrice: 0 })]);
  const chooseItem = (id: string, item: Item | null) => {
    if (!item) return patch(id, { itemId: undefined, description: "" });
    const line = lines.find((l) => l.id === id);
    const fresh = itemLine(item, line?.qty || 1, quoting);
    patch(id, { itemId: item.id, description: fresh.description, unit: fresh.unit, unitPrice: fresh.unitPrice, unitCost: fresh.unitCost });
  };
  const setQty = (id: string, qty: number) => {
    const line = lines.find((l) => l.id === id);
    const item = line?.itemId ? byId.get(line.itemId) : undefined;
    // Quantity breaks: re-price item lines from the catalogue unless the price was typed by hand.
    patch(id, { qty, ...(item && line && line.unitPrice === itemLine(item, line.qty, quoting).unitPrice ? { unitPrice: itemLine(item, qty, quoting).unitPrice } : {}) });
  };

  const draftWithNimbus = async () => {
    if (!prompt.trim()) return;
    setDrafting(true);
    setDraftNote(null);
    try {
      const res = await fetch("/api/quotes/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          currency,
          laborRate: quoting.laborRate,
          catalog: items.filter((i) => i.status === "active").map((i) => ({ sku: i.sku, name: i.name, category: i.category, type: i.type, unit: i.unit, price: i.price, unitCost: i.unitCost, onHand: i.onHand, bom: i.bom.length ? i.bom.map((b) => ({ sku: byId.get(b.itemId)?.sku ?? b.itemId, qty: b.qty })) : undefined })),
        }),
      });
      const data = (await res.json()) as (QuoteDraft & { questions?: string[] }) | { error: string };
      if (!res.ok || "error" in data) throw new Error("error" in data ? data.error : "Could not draft");
      const { lines: drafted, unresolved } = linesFromDraft(data, items, quoting);
      setLines((ls) => [...ls, ...drafted]);
      if (data.customer && !customer) setCustomer(data.customer);
      if (data.customerEmail && !email) setEmail(data.customerEmail);
      if (data.notes && !notes) setNotes(data.notes);
      const parts = [`${pluralize(drafted.length, "line")} added`];
      if (unresolved.length) parts.push(`not in inventory (kept as "other"): ${unresolved.join(", ")}`);
      if (data.questions?.length) parts.push(`to confirm: ${data.questions.join(" · ")}`);
      setDraftNote({ tone: unresolved.length || data.questions?.length ? "info" : "info", text: parts.join(" · ") });
    } catch (e) {
      setDraftNote({ tone: "critical", text: e instanceof Error ? e.message : "Could not draft" });
    } finally {
      setDrafting(false);
    }
  };

  const payload = () => ({
    customer: customer.trim(),
    customerEmail: email.trim() || undefined,
    lines: lines.filter((l) => l.description.trim() || l.itemId),
    discountPct: Number(discountPct) || undefined,
    taxPct: Number(taxPct) || undefined,
    validUntil: validUntil || undefined,
    notes: notes.trim() || undefined,
    terms: terms.trim() || undefined,
    sourcePrompt: prompt.trim() || undefined,
  });

  const save = async (): Promise<Quote | null> => {
    setError(null);
    if (!customer.trim()) {
      setError("Enter the customer");
      return null;
    }
    if (payload().lines.length === 0) {
      setError("Add at least one line");
      return null;
    }
    setBusy("save");
    try {
      if (quote) {
        await updateQuote(store, user, quote.id, payload());
        const next = { ...quote, ...payload(), updatedAt: new Date().toISOString() } as Quote;
        onSaved?.(next);
        toast(`Saved ${quote.number}`, "success");
        return next;
      }
      const created = await createQuote(store, user, payload());
      onSaved?.(created);
      toast(`Created ${created.number}`, "success");
      return created;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      return null;
    } finally {
      setBusy(null);
    }
  };

  const transition = async (status: "sent" | "accepted" | "declined" | "draft", withOrder = false) => {
    const saved = await save();
    if (!saved) return;
    setBusy(status);
    try {
      const res = await setQuoteStatus(store, user, saved.id, status, { createOrder: withOrder });
      toast(res.order ? `${saved.number} accepted · order ${res.order.number} created` : `${saved.number} marked ${status}`, "success");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update");
    } finally {
      setBusy(null);
      setConfirm(null);
    }
  };

  const print = async () => {
    const saved = quote ?? (await save());
    if (!saved) return;
    const w = window.open("", "_blank");
    if (!w) return toast("Allow pop-ups to print the quote", "critical");
    w.document.write(quoteHtml({ ...saved, ...payload() } as Quote, settings.companyName, (n) => formatMoney(n, currency)));
    w.document.close();
  };

  const exportCsv = () => {
    downloadCsv(`${quote?.number ?? "quote"}.csv`, ["Kind", "Description", "Qty", "Unit", "Unit price", "Discount %", "Line total", "Unit cost"], lines.map((l) => [l.kind, l.description, l.qty, l.unit ?? "", l.unitPrice, l.discountPct ?? "", lineTotal(l), l.unitCost ?? ""]));
  };

  const askNimbus = () => {
    openAgent(`I'm working on quote ${quote?.number ?? "(new)"} for ${customer || "a customer"}: ${lines.map((l) => `${l.description} × ${l.qty} @ ${l.unitPrice}`).join("; ") || "no lines yet"}. Total ${formatMoney(totals.total, currency)}, margin ${totals.marginPct ?? "—"}%. `, { send: false });
  };

  return (
    <Drawer
      open
      onClose={onClose}
      width={760}
      title={
        <span className="inline-flex items-center gap-2">
          {quote ? <span className="font-mono">{quote.number}</span> : "New quote"}
          {quote && <QuoteStatusBadge quote={quote} />}
          {quote?.orderId && <Badge tone="success">Order raised</Badge>}
        </span>
      }
      subtitle={quote ? `${quote.customer} · created ${quote.createdAt.slice(0, 10)}` : "Describe the job for Nimbus, or add lines by hand. Prices come from your items and labour rate."}
      headerActions={
        <div className="flex items-center gap-1">
          <IconButton size="sm" variant="plain" aria-label="Print or save as PDF" icon={<Printer />} onClick={() => void print()} />
          <IconButton size="sm" variant="plain" aria-label="Export lines as CSV" icon={<FileDown />} onClick={exportCsv} disabled={lines.length === 0} />
          <IconButton size="sm" variant="plain" aria-label="Ask Nimbus about this quote" icon={<Sparkles />} onClick={askNimbus} />
        </div>
      }
      footer={
        <>
          <div className="mr-auto text-[12.5px] text-text-secondary">
            Total <span className="font-semibold text-text tabular">{formatMoney(totals.total, currency)}</span>
            {totals.marginPct !== null && <span className={cn("ml-2", totals.marginPct < 15 ? "text-warning" : "")}>· margin {totals.marginPct}% ({formatMoney(totals.margin, currency)})</span>}
          </div>
          {quote && editable && quote.status !== "draft" && (
            <Button icon={<XCircle />} className="text-critical" onClick={() => void transition("declined")} loading={busy === "declined"} disabled={busy !== null}>
              Declined
            </Button>
          )}
          {quote && editable && (
            <Button icon={<ShoppingCart />} onClick={() => setConfirm("accept")} disabled={busy !== null}>
              Accepted…
            </Button>
          )}
          {editable && quote?.status === "draft" && (
            <Button icon={<Send />} onClick={() => void transition("sent")} loading={busy === "sent"} disabled={busy !== null}>
              Mark sent
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
          {editable && (
            <Button variant="primary" icon={<Check />} onClick={() => void save().then((q) => q && !quote && onClose())} loading={busy === "save"} disabled={busy !== null}>
              {quote ? "Save" : "Create quote"}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {locked && <Banner tone="info">This quote is {quote!.status}; it is kept as it was. Duplicate it from the list to start a new one.</Banner>}
        {quote && isQuoteExpired(quote) && <Banner tone="warning">Past its valid-until date. Extend the date or send a fresh quote.</Banner>}

        {editable && (
          <div className="rounded-[var(--radius)] border border-accent/30 bg-accent-soft/40 p-3">
            <div className="mb-1.5 flex items-center gap-2 text-[12.5px] font-semibold text-text">
              <Sparkles className="h-3.5 w-3.5 text-accent" /> Draft with Nimbus
            </div>
            <TextArea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. 12 overdrive pedals for Sweetwater, assembled and tested, ship by the 20th. Include 2 hours of setup." />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" icon={<Sparkles />} onClick={() => void draftWithNimbus()} loading={drafting} disabled={!prompt.trim()}>
                {lines.length ? "Add lines from this" : "Draft lines"}
              </Button>
              <span className="text-[11.5px] text-text-tertiary">Uses only your items and the labour rate from Settings ({formatMoney(quoting.laborRate, currency)}/h).</span>
            </div>
            {draftNote && (
              <Banner tone={draftNote.tone} className="mt-2">
                {draftNote.text}
              </Banner>
            )}
          </div>
        )}

        <FormGrid cols={3}>
          <div className="sm:col-span-2">
            <TextField label="Customer" value={customer} onChange={(e) => setCustomer(e.target.value)} disabled={!editable} autoFocus={!quote} />
          </div>
          <TextField label="Email" hint="(optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!editable} />
          <TextField label="Valid until" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} disabled={!editable} />
          <TextField label="Discount %" hint="(optional)" type="number" min={0} max={100} step="any" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} disabled={!editable} />
          <TextField label="Tax %" hint="(optional)" type="number" min={0} step="any" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} disabled={!editable} />
        </FormGrid>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12.5px] font-medium text-text">Lines</span>
            {editable && (
              <div className="flex gap-1">
                <Button size="sm" variant="plain" icon={<Plus />} onClick={() => addLine("item")}>
                  Item
                </Button>
                <Button size="sm" variant="plain" icon={<Plus />} onClick={() => addLine("labor")}>
                  Labour
                </Button>
                <Button size="sm" variant="plain" icon={<Plus />} onClick={() => addLine("other")}>
                  Other
                </Button>
              </div>
            )}
          </div>
          <div className="rounded-[var(--radius)] border border-border">
            <div className="hidden grid-cols-[92px_minmax(0,1fr)_76px_96px_64px_96px_28px] gap-2 border-b border-border bg-surface-subdued px-3 py-1.5 text-[12px] font-medium text-text-secondary sm:grid">
              <span>Kind</span>
              <span>Description</span>
              <span className="text-right">Qty</span>
              <span className="text-right">Unit price</span>
              <span className="text-right">Disc %</span>
              <span className="text-right">Total</span>
              <span />
            </div>
            {lines.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12.5px] text-text-tertiary">No lines yet. Describe the job above, or add a line.</div>
            ) : (
              lines.map((l) => {
                const item = l.itemId ? byId.get(l.itemId) : undefined;
                const short = item && item.onHand < l.qty;
                return (
                  <div key={l.id} className="grid grid-cols-1 gap-2 border-b border-border px-3 py-2 last:border-b-0 sm:grid-cols-[92px_minmax(0,1fr)_76px_96px_64px_96px_28px] sm:items-start">
                    <Select value={l.kind} onChange={(e) => patch(l.id, { kind: e.target.value as QuoteLineKind, itemId: undefined, unit: e.target.value === "labor" ? "h" : undefined, unitPrice: e.target.value === "labor" ? quoting.laborRate : l.unitPrice, unitCost: e.target.value === "labor" ? (quoting.laborCost ?? 0) : l.unitCost })} options={KIND_OPTIONS} disabled={!editable} aria-label="Line kind" />
                    <div className="min-w-0">
                      {l.kind === "item" ? (
                        <>
                          <ItemPicker value={item ?? null} onChange={(it) => chooseItem(l.id, it)} filter={(i) => i.status === "active"} placeholder="Search SKU or name" disabled={!editable} />
                          {item && <div className={cn("mt-0.5 text-[11.5px]", short ? "text-warning" : "text-text-tertiary")}>{formatQty(item.onHand, item.unit)} on hand{short ? ` · short by ${formatQty(l.qty - item.onHand, item.unit)}` : ""} · cost {formatMoney(item.unitCost, currency)}</div>}
                        </>
                      ) : (
                        <TextField value={l.description} onChange={(e) => patch(l.id, { description: e.target.value })} placeholder={l.kind === "labor" ? "Assembly and test" : "Shipping, packaging, a part not in inventory…"} disabled={!editable} aria-label="Description" />
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-2 sm:contents">
                      <TextField type="number" min={0} step="any" value={String(l.qty)} onChange={(e) => setQty(l.id, Number(e.target.value) || 0)} aria-label={l.kind === "labor" ? "Hours" : "Quantity"} className="text-right" suffix={l.unit} disabled={!editable} />
                      <TextField type="number" min={0} step="any" value={String(l.unitPrice)} onChange={(e) => patch(l.id, { unitPrice: Number(e.target.value) || 0 })} aria-label="Unit price" className="text-right" disabled={!editable} />
                      <TextField type="number" min={0} max={100} step="any" value={l.discountPct === undefined ? "" : String(l.discountPct)} onChange={(e) => patch(l.id, { discountPct: e.target.value === "" ? undefined : Number(e.target.value) })} aria-label="Discount %" className="text-right" disabled={!editable} />
                      <div className="flex h-8 items-center justify-end text-[13px] font-medium tabular">{formatMoney(lineTotal(l), currency)}</div>
                    </div>
                    <div className="flex justify-end">{editable && <IconButton variant="plain" size="sm" onClick={() => remove(l.id)} aria-label="Remove line" icon={<Trash2 />} className="text-text-tertiary hover:text-critical" />}</div>
                  </div>
                );
              })
            )}
            <div className="grid gap-1 border-t border-border bg-surface-subdued px-3 py-2 text-[12.5px] sm:grid-cols-[1fr_auto]">
              <div className="text-text-secondary">
                {pluralize(lines.length, "line")}
                {shortages.length > 0 && <span className="ml-2 text-warning">· {shortages.length} short on stock</span>}
                <span className="ml-2 text-text-tertiary">· cost {formatMoney(totals.cost, currency)}</span>
              </div>
              <div className="grid grid-cols-[auto_110px] gap-x-4 text-right tabular">
                <span className="text-text-secondary">Subtotal</span>
                <span>{formatMoney(totals.subtotal, currency)}</span>
                {totals.discount > 0 && (
                  <>
                    <span className="text-text-secondary">Discount</span>
                    <span>−{formatMoney(totals.discount, currency)}</span>
                  </>
                )}
                {totals.tax > 0 && (
                  <>
                    <span className="text-text-secondary">Tax</span>
                    <span>{formatMoney(totals.tax, currency)}</span>
                  </>
                )}
                <span className="font-semibold text-text">Total</span>
                <span className="font-semibold text-text">{formatMoney(totals.total, currency)}</span>
              </div>
            </div>
          </div>
        </div>

        <FormGrid cols={2}>
          <TextArea label="Notes for the customer" hint="(optional)" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!editable} />
          <TextArea label="Terms" hint="(optional)" rows={3} value={terms} onChange={(e) => setTerms(e.target.value)} disabled={!editable} />
        </FormGrid>
        {error && <Banner tone="critical">{error}</Banner>}
        {quote && writable && quote.status !== "accepted" && (
          <div className="flex justify-end">
            <Button size="sm" variant="plain" icon={<Trash2 />} className="text-critical" onClick={() => setConfirm("delete")}>
              Delete quote
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog open={confirm === "delete"} onClose={() => setConfirm(null)} destructive title={`Delete ${quote?.number}?`} confirmLabel="Delete" onConfirm={async () => { if (!quote) return; await deleteQuote(store, user, quote.id); toast(`Deleted ${quote.number}`, "success"); setConfirm(null); onClose(); }} message={<>The quote is removed. Any order already raised from it stays.</>} />
      <ConfirmDialog open={confirm === "accept"} onClose={() => setConfirm(null)} title={`Mark ${quote?.number ?? "this quote"} accepted?`} confirmLabel="Accept and create order" onConfirm={() => void transition("accepted", true)} loading={busy === "accepted"} message={<>A sales order is created for the {lines.filter((l) => l.kind === "item").length} item line{lines.filter((l) => l.kind === "item").length === 1 ? "" : "s"} at the quoted prices ({formatMoney(round(lines.filter((l) => l.kind === "item").reduce((a, l) => a + lineTotal(l), 0)), currency)}). Labour and extras are noted on the order.</>} />
    </Drawer>
  );
}
