import type { Item, Quote, QuoteLine, QuoteStatus, QuotingSettings, SalesOrder, WorkspaceSettings } from "@/lib/types";
import type { Store, WriteOp } from "@/lib/store/types";
import { activityOp, createOrder, nextNumber, priceForQty, type Actor } from "@/lib/inventory";
import { newId, nowIso, round, sum } from "@/lib/utils";

/**
 * Quotes: priced offers built from the workspace's own items, labour and
 * extras. Totals are computed, never stored, so a quote always adds up.
 */

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = { draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined", expired: "Expired" };

export const DEFAULT_QUOTING: QuotingSettings = { laborRate: 0, validDays: 30 };

export function quotingSettings(settings: Pick<WorkspaceSettings, "quoting">): QuotingSettings {
  return { ...DEFAULT_QUOTING, ...(settings.quoting ?? {}) };
}

export function lineTotal(l: QuoteLine): number {
  return round(l.qty * l.unitPrice * (1 - (l.discountPct ?? 0) / 100));
}

export function lineCost(l: QuoteLine): number {
  return round(l.qty * (l.unitCost ?? 0));
}

export interface QuoteTotals {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  cost: number;
  margin: number;
  marginPct: number | null;
}

export function quoteTotals(q: Pick<Quote, "lines" | "discountPct" | "taxPct">): QuoteTotals {
  const subtotal = round(sum(q.lines.map(lineTotal)));
  const discount = round(subtotal * ((q.discountPct ?? 0) / 100));
  const taxable = round(subtotal - discount);
  const tax = round(taxable * ((q.taxPct ?? 0) / 100));
  const total = round(taxable + tax);
  const cost = round(sum(q.lines.map(lineCost)));
  const margin = round(taxable - cost);
  return { subtotal, discount, tax, total, cost, margin, marginPct: taxable > 0 ? round((margin / taxable) * 100, 1) : null };
}

export function newQuoteLine(partial: Partial<QuoteLine> & Pick<QuoteLine, "kind">): QuoteLine {
  return { id: newId("ql"), description: "", qty: 1, unitPrice: 0, ...partial };
}

/** A line for an inventory item at its list price for that quantity (or cost plus the default margin when it has no price). */
export function itemLine(item: Item, qty: number, quoting: QuotingSettings): QuoteLine {
  const listed = priceForQty(item, qty);
  const price = listed > 0 ? listed : quoting.defaultMarginPct !== undefined && quoting.defaultMarginPct < 100 ? round(item.unitCost / (1 - quoting.defaultMarginPct / 100)) : item.unitCost;
  return newQuoteLine({ kind: "item", itemId: item.id, description: `${item.sku} · ${item.name}`, qty, unit: item.unit, unitPrice: price, unitCost: item.unitCost });
}

export function laborLine(hours: number, quoting: QuotingSettings, description = "Labour"): QuoteLine {
  return newQuoteLine({ kind: "labor", description, qty: hours, unit: "h", unitPrice: quoting.laborRate, unitCost: quoting.laborCost ?? 0 });
}

/** What Nimbus's draft looks like before SKUs are resolved against the workspace. */
export interface QuoteDraft {
  customer?: string;
  customerEmail?: string;
  notes?: string;
  lines: Array<{ kind: "item" | "labor" | "other"; sku?: string; description?: string; qty?: number; hours?: number; unitPrice?: number }>;
}

/** Turns a draft into real lines: SKUs become item lines at their prices, hours become labour, the rest is kept as typed. */
export function linesFromDraft(draft: QuoteDraft, items: Item[], quoting: QuotingSettings): { lines: QuoteLine[]; unresolved: string[] } {
  const bySku = new Map(items.map((i) => [i.sku.toUpperCase(), i]));
  const lines: QuoteLine[] = [];
  const unresolved: string[] = [];
  for (const d of draft.lines) {
    if (d.kind === "item") {
      const item = d.sku ? bySku.get(d.sku.trim().toUpperCase()) : undefined;
      if (!item) {
        unresolved.push(d.sku || d.description || "item");
        lines.push(newQuoteLine({ kind: "other", description: d.description || d.sku || "Item", qty: d.qty ?? 1, unitPrice: d.unitPrice ?? 0 }));
        continue;
      }
      const line = itemLine(item, Math.max(0, d.qty ?? 1), quoting);
      if (d.unitPrice !== undefined && d.unitPrice > 0) line.unitPrice = d.unitPrice;
      lines.push(line);
    } else if (d.kind === "labor") {
      const line = laborLine(Math.max(0, d.hours ?? d.qty ?? 1), quoting, d.description || "Labour");
      if (d.unitPrice !== undefined && d.unitPrice > 0) line.unitPrice = d.unitPrice;
      lines.push(line);
    } else {
      lines.push(newQuoteLine({ kind: "other", description: d.description || "Other", qty: d.qty ?? 1, unitPrice: d.unitPrice ?? 0 }));
    }
  }
  return { lines, unresolved };
}

export interface QuoteInput {
  customer: string;
  customerEmail?: string;
  lines: QuoteLine[];
  discountPct?: number;
  taxPct?: number;
  validUntil?: string;
  notes?: string;
  terms?: string;
  sourcePrompt?: string;
}

export function defaultValidUntil(quoting: QuotingSettings, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + Math.max(1, quoting.validDays));
  return d.toISOString().slice(0, 10);
}

export async function createQuote(store: Store, actor: Actor, input: QuoteInput): Promise<Quote> {
  const settings = await store.get("settings", "default");
  const { number, ops } = await nextNumber(store, "quote");
  const now = nowIso();
  const quote: Quote = {
    id: newId("qt"),
    number,
    customer: input.customer.trim() || "Customer",
    customerEmail: input.customerEmail?.trim() || undefined,
    status: "draft",
    lines: input.lines,
    discountPct: input.discountPct || undefined,
    taxPct: input.taxPct || undefined,
    currency: settings?.currency ?? "USD",
    validUntil: input.validUntil,
    notes: input.notes?.trim() || undefined,
    terms: input.terms?.trim() || undefined,
    sourcePrompt: input.sourcePrompt?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
    createdBy: actor.id,
  };
  ops.push({ op: "put", collection: "quotes", doc: quote });
  ops.push(activityOp(actor, "quote.created", `${actor.name} created ${number} for ${quote.customer} (${quote.lines.length} line${quote.lines.length === 1 ? "" : "s"})`, { entityType: "quote", entityId: quote.id }));
  await store.batch(ops);
  return quote;
}

export async function updateQuote(store: Store, actor: Actor, id: string, patch: Partial<Omit<Quote, "id" | "number" | "createdAt" | "createdBy">>): Promise<void> {
  await store.patch("quotes", id, { ...patch, updatedAt: nowIso() });
  void actor;
}

/** Marks the quote; accepting can raise the sales order in the same step. */
export async function setQuoteStatus(store: Store, actor: Actor, id: string, status: QuoteStatus, opts: { createOrder?: boolean } = {}): Promise<{ quote: Quote; order?: SalesOrder }> {
  const quote = await store.get("quotes", id);
  if (!quote) throw new Error("Quote not found");
  const now = nowIso();
  const patch: Partial<Quote> = { status, updatedAt: now };
  if (status === "sent") patch.sentAt = now;
  if (status === "accepted" || status === "declined") patch.decidedAt = now;
  let order: SalesOrder | undefined;
  if (status === "accepted" && opts.createOrder && !quote.orderId) {
    order = await orderFromQuote(store, actor, quote);
    patch.orderId = order.id;
  }
  const ops: WriteOp[] = [{ op: "patch", collection: "quotes", id, patch }];
  const type = status === "sent" ? "quote.sent" : status === "accepted" ? "quote.accepted" : status === "declined" ? "quote.declined" : null;
  if (type) ops.push(activityOp(actor, type, `${actor.name} marked ${quote.number} ${QUOTE_STATUS_LABEL[status].toLowerCase()}${order ? ` and created ${order.number}` : ""}`, { entityType: "quote", entityId: id }));
  await store.batch(ops);
  return { quote: { ...quote, ...patch }, order };
}

/** A sales order for the quote's item lines at the quoted prices. Labour and extras are noted on the order. */
export async function orderFromQuote(store: Store, actor: Actor, quote: Quote): Promise<SalesOrder> {
  const lines = quote.lines.filter((l) => l.kind === "item" && l.itemId && l.qty > 0).map((l) => ({ itemId: l.itemId!, qty: l.qty, unitPrice: round(l.unitPrice * (1 - (l.discountPct ?? 0) / 100)) }));
  if (lines.length === 0) throw new Error("The quote has no item lines to turn into an order");
  const extras = quote.lines.filter((l) => l.kind !== "item").map((l) => `${l.description}: ${l.qty}${l.unit ? ` ${l.unit}` : ""} × ${l.unitPrice}`);
  const note = [`From quote ${quote.number}`, ...(extras.length ? [`Also quoted: ${extras.join("; ")}`] : []), ...(quote.notes ? [quote.notes] : [])].join("\n");
  return createOrder(store, actor, { customer: quote.customer, customerEmail: quote.customerEmail, note, lines, source: "manual" });
}

export async function deleteQuote(store: Store, actor: Actor, id: string): Promise<void> {
  await store.remove("quotes", id);
  void actor;
}

export function isQuoteExpired(q: Quote, now = new Date()): boolean {
  return (q.status === "draft" || q.status === "sent") && !!q.validUntil && new Date(q.validUntil + "T23:59:59") < now;
}

/** Item lines short on stock, for the editor's availability hints. */
export function quoteShortages(q: Pick<Quote, "lines">, byId: Map<string, Item>): Array<{ line: QuoteLine; item: Item; have: number }> {
  const out: Array<{ line: QuoteLine; item: Item; have: number }> = [];
  for (const l of q.lines) {
    if (l.kind !== "item" || !l.itemId) continue;
    const item = byId.get(l.itemId);
    if (item && item.onHand < l.qty) out.push({ line: l, item, have: item.onHand });
  }
  return out;
}

/** Print-ready HTML for a quote, opened in a new window where the browser's Save as PDF does the rest. */
export function quoteHtml(q: Quote, company: string, formatMoney: (n: number) => string): string {
  const t = quoteTotals(q);
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const rows = q.lines
    .map((l) => `<tr><td>${esc(l.description)}${l.note ? `<div class="muted">${esc(l.note)}</div>` : ""}</td><td class="num">${l.qty}${l.unit ? ` ${esc(l.unit)}` : ""}</td><td class="num">${formatMoney(l.unitPrice)}</td><td class="num">${l.discountPct ? `${l.discountPct}%` : ""}</td><td class="num">${formatMoney(lineTotal(l))}</td></tr>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(q.number)} · ${esc(company)}</title>
<style>body{font:13px/1.45 -apple-system,Inter,Segoe UI,sans-serif;color:#1a1a1a;margin:40px;max-width:820px}h1{font-size:22px;margin:0 0 2px}.muted{color:#666;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{padding:8px 6px;border-bottom:1px solid #e3e3e3;text-align:left;vertical-align:top}th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#666}.num{text-align:right;font-variant-numeric:tabular-nums}.totals{margin-top:12px;margin-left:auto;width:280px}.totals td{border:0;padding:3px 6px}.totals .grand td{border-top:2px solid #1a1a1a;font-weight:600;font-size:15px}.head{display:flex;justify-content:space-between;gap:24px}.box{margin-top:18px;padding:12px;border:1px solid #e3e3e3;border-radius:8px;white-space:pre-wrap}@media print{body{margin:16px}}</style></head><body>
<div class="head"><div><h1>${esc(company)}</h1><div class="muted">Quote ${esc(q.number)}</div></div><div style="text-align:right"><div><strong>${esc(q.customer)}</strong></div>${q.customerEmail ? `<div class="muted">${esc(q.customerEmail)}</div>` : ""}<div class="muted">Issued ${q.createdAt.slice(0, 10)}${q.validUntil ? ` · Valid until ${q.validUntil}` : ""}</div></div></div>
<table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Discount</th><th class="num">Total</th></tr></thead><tbody>${rows}</tbody></table>
<table class="totals"><tr><td>Subtotal</td><td class="num">${formatMoney(t.subtotal)}</td></tr>${t.discount ? `<tr><td>Discount (${q.discountPct}%)</td><td class="num">−${formatMoney(t.discount)}</td></tr>` : ""}${t.tax ? `<tr><td>Tax (${q.taxPct}%)</td><td class="num">${formatMoney(t.tax)}</td></tr>` : ""}<tr class="grand"><td>Total</td><td class="num">${formatMoney(t.total)}</td></tr></table>
${q.notes ? `<div class="box">${esc(q.notes)}</div>` : ""}${q.terms ? `<div class="box muted">${esc(q.terms)}</div>` : ""}
<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},150)})</script></body></html>`;
}
