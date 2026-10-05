import type { Item, OrderEmail, SalesOrder, Shipment, WorkspaceSettings } from "@/lib/types";

/**
 * The emails a customer gets about an order: a confirmation when it is
 * created and a shipping update when a shipment goes out. Pure, so the server
 * route sends exactly what the settings page previews.
 */

export type OrderEmailKind = OrderEmail["kind"];

export interface OrderEmailInput {
  order: SalesOrder;
  /** The shipment a shipping update is about; the latest one when several exist. */
  shipment?: Shipment | null;
  items: Map<string, Pick<Item, "sku" | "name" | "unit">>;
  settings: Pick<WorkspaceSettings, "companyName" | "currency" | "notifications">;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export const ORDER_EMAIL_LABELS: Record<OrderEmailKind, string> = { confirmed: "Order confirmation", shipped: "Shipping update" };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function firstName(order: SalesOrder): string {
  const name = (order.shipTo?.name || order.customer || "").trim();
  return name.split(/\s+/)[0] || "there";
}

function addressLines(order: SalesOrder): string[] {
  const a = order.shipTo;
  if (!a?.street1) return [];
  return [a.name, a.company, a.street1, a.street2, `${a.city}${a.state ? ", " + a.state : ""} ${a.zip}`.trim(), a.country].filter((s): s is string => !!s && s.trim() !== "");
}

export function renderOrderEmail(kind: OrderEmailKind, input: OrderEmailInput): RenderedEmail {
  const { order, settings } = input;
  const company = settings.companyName?.trim() || "Your order";
  const currency = settings.currency || "USD";
  const label = (id: string) => {
    const it = input.items.get(id);
    return it ? `${it.name} (${it.sku})` : id;
  };
  const signature = settings.notifications?.signature?.trim();
  const closing = [signature, company].filter(Boolean).join("\n");
  const closingHtml = [signature, company]
    .filter(Boolean)
    .map((s) => esc(s!).replace(/\n/g, "<br>"))
    .join("<br>");
  const wrap = (body: string) => `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#303030;line-height:1.5;font-size:15px">${body}<p style="color:#616161;margin-top:24px">${closingHtml}</p></div>`;
  const rows = (lines: Array<{ label: string; qty: number; price?: number }>) =>
    `<table style="border-collapse:collapse;margin:12px 0">${lines.map((l) => `<tr><td style="padding:4px 12px 4px 0">${l.qty} ×</td><td style="padding:4px 12px 4px 0">${esc(l.label)}</td>${l.price !== undefined ? `<td style="padding:4px 0;text-align:right">${esc(money(l.qty * l.price, currency))}</td>` : ""}</tr>`).join("")}</table>`;

  if (kind === "confirmed") {
    const lines = order.lines.map((l) => ({ label: label(l.itemId), qty: l.qty, price: l.unitPrice }));
    const total = order.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0);
    const to = addressLines(order);
    const subject = `${company}: order ${order.number} received`;
    const text = [
      `Hi ${firstName(order)},`,
      "",
      `Thanks for your order. Here is what we have on file as ${order.number}:`,
      "",
      ...lines.map((l) => `- ${l.qty} × ${l.label} · ${money(l.qty * l.price, currency)}`),
      `Total: ${money(total, currency)}`,
      ...(to.length ? ["", `Shipping to: ${to.join(", ")}`] : []),
      "",
      "We will email again when it ships.",
      "",
      closing,
    ].join("\n");
    const html = wrap(`<p>Hi ${esc(firstName(order))},</p><p>Thanks for your order. Here is what we have on file as <strong>${esc(order.number)}</strong>:</p>${rows(lines)}<p><strong>Total: ${esc(money(total, currency))}</strong></p>${to.length ? `<p style="color:#616161">Shipping to: ${esc(to.join(", "))}</p>` : ""}<p>We will email again when it ships.</p>`);
    return { subject, text, html };
  }

  const shipment = input.shipment ?? null;
  const lines = (shipment?.lines ?? order.lines.filter((l) => (l.shipped ?? 0) > 0).map((l) => ({ itemId: l.itemId, qty: l.shipped ?? 0 }))).map((l) => ({ label: label(l.itemId), qty: l.qty }));
  const remaining = order.lines.reduce((a, l) => a + Math.max(0, l.qty - (l.shipped ?? 0)), 0);
  const carrier = [shipment?.carrier, shipment?.service].filter(Boolean).join(" ");
  const when = shipment?.shippedAt ? day(shipment.shippedAt) : "";
  const subject = `${company}: order ${order.number} is on its way`;
  const text = [
    `Hi ${firstName(order)},`,
    "",
    `Your order ${order.number} shipped${when ? ` on ${when}` : ""}.`,
    "",
    ...lines.map((l) => `- ${l.qty} × ${l.label}`),
    ...(carrier ? ["", `Carrier: ${carrier}`] : []),
    ...(shipment?.trackingNumber ? [`Tracking: ${shipment.trackingNumber}${shipment.trackingUrl ? ` (${shipment.trackingUrl})` : ""}`] : []),
    ...(remaining > 0 ? ["", `${remaining} unit${remaining === 1 ? "" : "s"} on this order ${remaining === 1 ? "is" : "are"} still to come; we will let you know when ${remaining === 1 ? "it" : "they"} ship.`] : []),
    "",
    closing,
  ].join("\n");
  const tracking = shipment?.trackingNumber ? (shipment.trackingUrl ? `<a href="${esc(shipment.trackingUrl)}">${esc(shipment.trackingNumber)}</a>` : esc(shipment.trackingNumber)) : "";
  const html = wrap(`<p>Hi ${esc(firstName(order))},</p><p>Your order <strong>${esc(order.number)}</strong> shipped${when ? ` on ${esc(when)}` : ""}.</p>${rows(lines)}${carrier ? `<p>Carrier: ${esc(carrier)}</p>` : ""}${tracking ? `<p>Tracking: ${tracking}</p>` : ""}${remaining > 0 ? `<p style="color:#616161">${remaining} unit${remaining === 1 ? "" : "s"} on this order ${remaining === 1 ? "is" : "are"} still to come; we will let you know when ${remaining === 1 ? "it" : "they"} ship.</p>` : ""}`);
  return { subject, text, html };
}

/** A made-up order for the settings preview. */
export function sampleOrderEmail(kind: OrderEmailKind, settings: OrderEmailInput["settings"]): RenderedEmail {
  const now = new Date().toISOString();
  const order: SalesOrder = {
    id: "sample",
    number: "SO-1042",
    customer: "Dana Reyes",
    status: "partial",
    source: "manual",
    lines: [
      { itemId: "a", qty: 2, unitPrice: 189, shipped: 2 },
      { itemId: "b", qty: 1, unitPrice: 24.5, shipped: 0 },
    ],
    shipTo: { name: "Dana Reyes", street1: "418 Pine St", city: "Portland", state: "OR", zip: "97204", country: "US" },
    createdAt: now,
    createdBy: "sample",
  };
  const shipment: Shipment = { id: "sample-shipment", number: "SH-1007", orderId: order.id, lines: [{ itemId: "a", qty: 2 }], carrier: "UPS", service: "Ground", trackingNumber: "1Z999AA10123456784", trackingUrl: "https://www.ups.com/track?tracknum=1Z999AA10123456784", shippedAt: now, createdAt: now, createdBy: "sample" };
  const items = new Map<string, Pick<Item, "sku" | "name" | "unit">>([
    ["a", { sku: "FG-OD1-BLK", name: "Halcyon Overdrive, black", unit: "ea" }],
    ["b", { sku: "ACC-PSU-9V", name: "9V power supply", unit: "ea" }],
  ]);
  return renderOrderEmail(kind, { order, shipment, items, settings });
}
