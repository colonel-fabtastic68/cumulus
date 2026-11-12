import type { Item, PurchaseOrder, SalesOrder, Supplier, WorkspaceSettings } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { escapeHtml } from "@/lib/print";
import { describeQty } from "@/lib/units";
import { round, sum } from "@/lib/utils";
import { termsFor } from "@/lib/terminology";

/**
 * Emails for purchase orders (to the supplier) and sales orders (a
 * confirmation to the customer). The same text is used by the server route
 * that sends through cumulusOS and by the mailto: fallback that opens the
 * person's own mail app (local mode, or no mail service configured).
 */

export type EmailDocumentKind = "purchaseOrder" | "order";

export interface DocumentEmailDraft {
  to: string;
  subject: string;
  /** Plain text: the whole message, including the line table. */
  text: string;
  html: string;
}

export interface EmailContext {
  items: Map<string, Item>;
  settings: Pick<WorkspaceSettings, "companyName" | "currency" | "terminology" | "features">;
  /** Who is sending, for the sign-off. */
  senderName?: string;
  /** Extra words from the sender, placed above the lines. */
  message?: string;
  /** Use the workspace's own word for the item code (feature "partNumbers"). */
  useTerms?: boolean;
}

interface Row {
  code: string;
  name: string;
  qty: string;
  each: number;
  total: number;
  extra?: string;
}

function layout(opts: { greeting: string; intro: string; message?: string; codeLabel: string; rows: Row[]; total: number; currency: string; facts: Array<[string, string | undefined]>; closing: string; senderName?: string; companyName: string; priceLabel: string }): { text: string; html: string } {
  const money = (n: number) => formatMoney(n, opts.currency);
  const facts = opts.facts.filter((f): f is [string, string] => !!f[1]);
  const sign = [opts.senderName, opts.companyName].filter(Boolean).join("\n");
  const text = [
    opts.greeting,
    "",
    opts.intro,
    ...(opts.message?.trim() ? ["", opts.message.trim()] : []),
    "",
    ...opts.rows.map((r) => `${r.qty} × ${r.code}  ${r.name}${r.extra ? ` (${r.extra})` : ""}  @ ${money(r.each)} = ${money(r.total)}`),
    "",
    `Total: ${money(opts.total)}`,
    ...(facts.length ? ["", ...facts.map(([k, v]) => `${k}: ${v}`)] : []),
    "",
    opts.closing,
    "",
    sign,
  ].join("\n");
  const cell = "padding:6px 8px;border-bottom:1px solid #e3e3e3;text-align:left;vertical-align:top";
  const num = `${cell};text-align:right;white-space:nowrap`;
  const html = `<div style="font:14px/1.55 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#303030;max-width:640px">
<p>${escapeHtml(opts.greeting)}</p>
<p>${escapeHtml(opts.intro)}</p>
${opts.message?.trim() ? `<p style="white-space:pre-line">${escapeHtml(opts.message.trim())}</p>` : ""}
<table style="border-collapse:collapse;width:100%;font-size:13px">
<thead><tr><th style="${cell};font-size:11.5px;color:#616161">${escapeHtml(opts.codeLabel)}</th><th style="${cell};font-size:11.5px;color:#616161">Description</th><th style="${num};font-size:11.5px;color:#616161">Qty</th><th style="${num};font-size:11.5px;color:#616161">${escapeHtml(opts.priceLabel)}</th><th style="${num};font-size:11.5px;color:#616161">Total</th></tr></thead>
<tbody>${opts.rows.map((r) => `<tr><td style="${cell};font-family:ui-monospace,Menlo,monospace;font-size:12.5px">${escapeHtml(r.code)}</td><td style="${cell}">${escapeHtml(r.name)}${r.extra ? `<div style="color:#616161;font-size:12px">${escapeHtml(r.extra)}</div>` : ""}</td><td style="${num}">${escapeHtml(r.qty)}</td><td style="${num}">${escapeHtml(money(r.each))}</td><td style="${num}">${escapeHtml(money(r.total))}</td></tr>`).join("")}</tbody>
<tfoot><tr><td colspan="4" style="${num};border-bottom:0;font-weight:600">Total</td><td style="${num};border-bottom:0;font-weight:600">${escapeHtml(money(opts.total))}</td></tr></tfoot>
</table>
${facts.length ? `<p>${facts.map(([k, v]) => `<span style="color:#616161">${escapeHtml(k)}:</span> ${escapeHtml(v)}`).join("<br>")}</p>` : ""}
<p>${escapeHtml(opts.closing)}</p>
<p>${escapeHtml(sign).replace(/\n/g, "<br>")}</p>
</div>`;
  return { text, html };
}

function addressLines(a?: { name?: string; company?: string; street1: string; street2?: string; city: string; state?: string; zip: string; country: string }): string | undefined {
  if (!a?.street1?.trim()) return undefined;
  return [a.name, a.company, a.street1, a.street2, [a.city, a.state, a.zip].filter(Boolean).join(" "), a.country].filter(Boolean).join(", ");
}

export function purchaseOrderEmail(po: PurchaseOrder, ctx: EmailContext & { supplier?: Supplier }): DocumentEmailDraft {
  const terms = termsFor(ctx.settings, ctx.useTerms ?? false);
  const contact = ctx.supplier?.contacts?.[0];
  const rows: Row[] = po.lines.map((l) => {
    const item = ctx.items.get(l.itemId);
    const unit = item ? { unit: item.unit } : { unit: "ea" };
    return { code: l.supplierSku || item?.sku || l.itemId, name: item?.name ?? "", qty: describeQty(unit, l.qty, l.entered), each: l.unitCost, total: round(l.qty * l.unitCost), extra: [l.supplierSku && item ? `our ${terms.itemCodeShort} ${item.sku}` : "", l.note ?? ""].filter(Boolean).join(" · ") || undefined };
  });
  const body = layout({
    greeting: `Hello${contact?.name ? ` ${contact.name.split(/\s+/)[0]}` : ""},`,
    intro: `Please find purchase order ${po.number} from ${ctx.settings.companyName} below.`,
    message: ctx.message,
    codeLabel: "Part",
    priceLabel: "Unit cost",
    rows,
    total: round(sum(rows.map((r) => r.total))),
    currency: ctx.settings.currency,
    facts: [
      ["Needed by", po.expectedAt ? formatDate(po.expectedAt) : undefined],
      ["Ship to", addressLines(po.shipTo)],
      ["Terms", po.terms],
      ["Your reference", po.reference],
      ["Notes", po.note],
    ],
    closing: "Please reply to confirm the order and the ship date.",
    senderName: ctx.senderName,
    companyName: ctx.settings.companyName,
  });
  return { to: contact?.email ?? ctx.supplier?.email ?? "", subject: `Purchase order ${po.number} from ${ctx.settings.companyName}`, ...body };
}

export function salesOrderEmail(order: SalesOrder, ctx: EmailContext): DocumentEmailDraft {
  const terms = termsFor(ctx.settings, ctx.useTerms ?? false);
  const rows: Row[] = order.lines.map((l) => {
    const item = ctx.items.get(l.itemId);
    return { code: item?.sku ?? l.itemId, name: item?.name ?? "", qty: describeQty({ unit: item?.unit ?? "ea" }, l.qty, l.entered), each: l.unitPrice, total: round(l.qty * l.unitPrice) };
  });
  const first = order.customer.trim().split(/\s+/)[0];
  const body = layout({
    greeting: `Hello${first && first.toLowerCase() !== "walk-in" ? ` ${first}` : ""},`,
    intro: `Thank you for your order. This confirms order ${order.number} with ${ctx.settings.companyName}.`,
    message: ctx.message,
    codeLabel: terms.itemCode,
    priceLabel: "Unit price",
    rows,
    total: round(sum(rows.map((r) => r.total))),
    currency: ctx.settings.currency,
    facts: [
      ["Order date", formatDate(order.createdAt)],
      ["Ship to", addressLines(order.shipTo)],
      ["Your reference", order.externalRef],
    ],
    closing: "Reply to this email if anything needs to change.",
    senderName: ctx.senderName,
    companyName: ctx.settings.companyName,
  });
  return { to: order.customerEmail ?? "", subject: `Order ${order.number} from ${ctx.settings.companyName}`, ...body };
}

/** Opens the person's own mail app with the message filled in. Mail apps cap the length, so long orders are cut with a note. */
export function mailtoHref(draft: Pick<DocumentEmailDraft, "to" | "subject" | "text">): string {
  const max = 1800;
  const body = draft.text.length > max ? `${draft.text.slice(0, max)}\n…\n(The full order is attached as a PDF: use Print / PDF and attach it.)` : draft.text;
  return `mailto:${encodeURIComponent(draft.to)}?subject=${encodeURIComponent(draft.subject)}&body=${encodeURIComponent(body)}`;
}
