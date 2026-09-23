"use client";

import type { Item, PurchaseOrder, PurchaseOrderStatus, Supplier, WorkspaceSettings } from "@/lib/types";
import { formatMoney } from "@/lib/format";
import { poLineOpenQty, poTotal } from "@/lib/purchaseOrders";
import { Badge, type BadgeTone } from "@/components/ui";

export { currencySymbol } from "@/components/orders/orderUtils";

export type PoFilter = "open" | "draft" | "sent" | "partial" | "received" | "cancelled" | "all";

export const PO_STATUS_LABEL: Record<PurchaseOrderStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partial: "Partly received",
  received: "Received",
  cancelled: "Cancelled",
};

const TONE: Record<PurchaseOrderStatus, BadgeTone> = { draft: "default", sent: "info", partial: "attention", received: "success", cancelled: "default" };

export function PoStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <Badge tone={TONE[status]}>{PO_STATUS_LABEL[status]}</Badge>;
}

/** Value of what is still to arrive. */
export function poOpenValue(po: PurchaseOrder): number {
  return po.lines.reduce((t, l) => t + poLineOpenQty(l) * l.unitCost, 0);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** Opens a printable purchase order (the browser's print dialog offers Save as PDF). */
export function printPurchaseOrder(po: PurchaseOrder, ctx: { items: Map<string, Item>; settings: WorkspaceSettings; supplier?: Supplier }): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  const { settings, supplier } = ctx;
  const money = (n: number) => esc(formatMoney(n, settings.currency));
  const rows = po.lines
    .map((l, i) => {
      const item = ctx.items.get(l.itemId);
      return `<tr><td class="n">${i + 1}</td><td class="mono">${esc(item?.sku ?? l.itemId)}</td><td class="mono">${esc(l.supplierSku ?? "")}</td><td>${esc(item?.name ?? "")}${l.note ? `<div class="muted">${esc(l.note)}</div>` : ""}</td><td class="n">${l.qty}</td><td>${esc(item?.unit ?? "")}</td><td class="n">${money(l.unitCost)}</td><td class="n">${money(l.qty * l.unitCost)}</td></tr>`;
    })
    .join("");
  const meta = [
    ["Date", po.sentAt ? po.sentAt.slice(0, 10) : po.createdAt.slice(0, 10)],
    ["Expected", po.expectedAt ?? ""],
    ["Terms", po.terms ?? ""],
    ["Reference", po.reference ?? ""],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<div><span class="muted">${esc(k)}</span> ${esc(v!)}</div>`)
    .join("");
  const supplierBlock = [supplier?.name ?? po.supplier, supplier?.contacts?.[0]?.name, supplier?.email, supplier?.phone].filter(Boolean).map((s) => esc(String(s))).join("<br>");
  const shipTo = po.shipTo ? [po.shipTo.name ?? settings.companyName, po.shipTo.company, po.shipTo.street1, po.shipTo.street2, [po.shipTo.city, po.shipTo.state, po.shipTo.zip].filter(Boolean).join(" "), po.shipTo.country].filter(Boolean).map((s) => esc(String(s))).join("<br>") : esc(settings.companyName);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(po.number)} · ${esc(settings.companyName)}</title><style>
body{font:12px/1.45 -apple-system,Inter,Segoe UI,sans-serif;color:#1a1a1a;margin:32px;max-width:900px}
h1{font-size:22px;margin:0}.head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:2px solid #1a1a1a;padding-bottom:12px}
.muted{color:#666}.blocks{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:18px 0}.blocks h3{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#666;margin:0 0 4px}
table{border-collapse:collapse;width:100%;margin-top:8px}th,td{border-bottom:1px solid #ddd;padding:6px 6px;text-align:left;vertical-align:top}th{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#666}
.n{text-align:right;white-space:nowrap}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}tfoot td{border:0;font-weight:600;padding-top:10px}
.note{margin-top:18px;white-space:pre-line}@page{margin:14mm}
</style></head><body>
<div class="head"><div><h1>Purchase order ${esc(po.number)}</h1><div class="muted">${esc(settings.companyName)}</div></div><div style="text-align:right">${meta}</div></div>
<div class="blocks"><div><h3>Supplier</h3><div>${supplierBlock}</div></div><div><h3>Ship to</h3><div>${shipTo}</div></div></div>
<table><thead><tr><th class="n">#</th><th>SKU</th><th>Supplier SKU</th><th>Description</th><th class="n">Qty</th><th>Unit</th><th class="n">Unit cost</th><th class="n">Total</th></tr></thead><tbody>${rows}</tbody>
<tfoot><tr><td colspan="7" class="n">Total</td><td class="n">${money(poTotal(po))}</td></tr></tfoot></table>
${po.note ? `<div class="note"><strong>Notes</strong><br>${esc(po.note)}</div>` : ""}
<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},200)})</script></body></html>`);
  w.document.close();
  return true;
}
