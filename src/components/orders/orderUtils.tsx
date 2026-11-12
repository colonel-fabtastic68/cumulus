"use client";

import type { Item, OrderSource, SalesOrder, WorkspaceSettings } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { escapeHtml, openPrintWindow } from "@/lib/print";
import { describeQty } from "@/lib/units";
import { openQty } from "@/lib/inventory";
import { round, sum } from "@/lib/utils";
import { Badge, type BadgeTone } from "@/components/ui";

export type OrderFilter = "open" | "partial" | "backordered" | "fulfilled" | "cancelled" | "all";

export const SOURCE_LABEL: Record<OrderSource, string> = {
  manual: "Manual",
  shopify: "Shopify",
  woocommerce: "WooCommerce",
  import: "Import",
};

const SOURCE_TONE: Record<OrderSource, BadgeTone> = {
  manual: "default",
  shopify: "accent",
  woocommerce: "info",
  import: "default",
};

export function SourceBadge({ source }: { source: OrderSource }) {
  return <Badge tone={SOURCE_TONE[source] ?? "default"}>{SOURCE_LABEL[source] ?? source}</Badge>;
}

/** Sum of qty × unit price across the order's lines. */
export function orderTotal(order: SalesOrder): number {
  return round(sum(order.lines.map((l) => l.qty * l.unitPrice)));
}

/** Total units across the order's lines. */
export function orderUnits(order: SalesOrder): number {
  return sum(order.lines.map((l) => l.qty));
}

/** Units still to ship. */
export function orderOpenUnits(order: SalesOrder): number {
  return sum(order.lines.map(openQty));
}

/** Units already shipped. */
export function orderShippedUnits(order: SalesOrder): number {
  return sum(order.lines.map((l) => l.shipped ?? 0));
}

export interface ShortLine {
  sku: string;
  have: number;
  need: number;
  isAssembly: boolean;
}

export interface OrderAvailability {
  ready: boolean;
  short: ShortLine[];
}

/** Whether every open line can ship from what is on the shelf right now. */
export function orderAvailability(order: SalesOrder, byId: Map<string, Item>): OrderAvailability {
  const short: ShortLine[] = [];
  for (const line of order.lines) {
    const need = openQty(line);
    if (need <= 0) continue;
    const item = byId.get(line.itemId);
    const have = item?.onHand ?? 0;
    if (have < need) {
      short.push({ sku: item?.sku ?? line.itemId, have, need, isAssembly: !!item && item.type === "assembly" && item.bom.length > 0 });
    }
  }
  return { ready: short.length === 0, short };
}

export function describeShortages(short: ShortLine[]): string {
  return short.map((s) => `${s.sku}: have ${s.have}, need ${s.need}`).join("; ");
}

/** The currency symbol on its own, for input prefixes. */
export function currencySymbol(currency: string): string {
  return formatMoney(0, currency).replace(/[\d.,\s]/g, "") || "$";
}

export function withinDays(iso: string | undefined, days: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= days * 86_400_000;
}

/** Opens a printable sales order (the browser's print dialog offers Save as PDF). False when pop-ups are blocked. */
export function printSalesOrder(order: SalesOrder, ctx: { items: Map<string, Item>; settings: Pick<WorkspaceSettings, "companyName" | "currency">; itemCodeLabel?: string }): boolean {
  const money = (n: number) => escapeHtml(formatMoney(n, ctx.settings.currency));
  const rows = order.lines
    .map((l, i) => {
      const item = ctx.items.get(l.itemId);
      return `<tr><td class="n">${i + 1}</td><td class="mono">${escapeHtml(item?.sku ?? l.itemId)}</td><td>${escapeHtml(item?.name ?? "")}</td><td class="n">${escapeHtml(describeQty({ unit: item?.unit ?? "ea" }, l.qty, l.entered))}</td><td class="n">${money(l.unitPrice)}</td><td class="n">${money(l.qty * l.unitPrice)}</td></tr>`;
    })
    .join("");
  const a = order.shipTo;
  const shipTo = a?.street1 ? [a.name ?? order.customer, a.company, a.street1, a.street2, [a.city, a.state, a.zip].filter(Boolean).join(" "), a.country, a.phone].filter(Boolean).map((x) => escapeHtml(String(x))).join("<br>") : "";
  const meta = [
    ["Date", formatDate(order.createdAt)],
    ["Status", order.status === "partial" ? "Partly shipped" : order.status[0]!.toUpperCase() + order.status.slice(1)],
    ["Reference", order.externalRef ?? ""],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<div><span class="muted">${escapeHtml(k!)}</span> ${escapeHtml(v!)}</div>`)
    .join("");
  const body = `<div class="head"><div><h1>Sales order ${escapeHtml(order.number)}</h1><div class="muted">${escapeHtml(ctx.settings.companyName)}</div></div><div style="text-align:right">${meta}</div></div>
<div class="blocks"><div><h3>Customer</h3><div>${escapeHtml(order.customer)}${order.customerEmail ? `<br>${escapeHtml(order.customerEmail)}` : ""}</div></div><div><h3>Ship to</h3><div>${shipTo || "&mdash;"}</div></div></div>
<table><thead><tr><th class="n">#</th><th>${escapeHtml(ctx.itemCodeLabel ?? "SKU")}</th><th>Description</th><th class="n">Qty</th><th class="n">Unit price</th><th class="n">Total</th></tr></thead><tbody>${rows}</tbody>
<tfoot><tr><td colspan="5" class="n">Total</td><td class="n">${money(orderTotal(order))}</td></tr></tfoot></table>
${order.note ? `<div class="note"><strong>Notes</strong><br>${escapeHtml(order.note)}</div>` : ""}`;
  // Same sheet style as the purchase order print: ruled rows instead of a boxed grid.
  const css = `body{max-width:900px}.head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:2px solid #1a1a1a;padding-bottom:12px}
.blocks{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:18px 0}.blocks h3{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#666;margin:0 0 4px}
th,td{border:0;border-bottom:1px solid #ddd;vertical-align:top}th{background:none;color:#666}tfoot td{border:0;font-weight:600;padding-top:10px}.note{margin-top:18px;white-space:pre-line}`;
  return openPrintWindow(`${order.number} · ${ctx.settings.companyName}`, body, css);
}
