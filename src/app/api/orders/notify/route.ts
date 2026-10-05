import type { OrderEmail } from "@/lib/types";
import { activityOp } from "@/lib/inventory";
import { HttpError, authenticate, jsonError, readJson } from "@/lib/integrations/server";
import { renderOrderEmail } from "@/lib/orderEmails";
import { emailConfigured, sendEmail } from "@/lib/server/email";
import { nowIso } from "@/lib/utils";

export const maxDuration = 30;

interface NotifyBody {
  orderId?: string;
  kind?: string;
  shipmentId?: string;
  /** Send even when the setting is off or the same email already went out (the buttons on the order). */
  force?: boolean;
}

/**
 * Emails the customer about an order: a confirmation, or a shipping update
 * for one shipment. Called by the app after an order is created or shipped
 * (respecting Settings → Notifications) and by the buttons on the order.
 * Each send is recorded on the order so nothing goes out twice by accident.
 */
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req, { write: true });
    const body = await readJson<NotifyBody>(req);
    const kind: OrderEmail["kind"] | null = body.kind === "shipped" ? "shipped" : body.kind === "confirmed" ? "confirmed" : null;
    if (!kind || typeof body.orderId !== "string" || !body.orderId) throw new HttpError(400, "Send an orderId and a kind of confirmed or shipped.");
    const force = body.force === true;
    const order = await ctx.store.get("orders", body.orderId);
    if (!order) throw new HttpError(404, "Order not found.");
    const settings = await ctx.store.get("settings", "default");
    const enabled = kind === "shipped" ? settings?.notifications?.orderShipped === true : settings?.notifications?.orderConfirmed === true;
    if (!force && !enabled) return Response.json({ ok: true, skipped: "off" });
    if (!emailConfigured()) throw new HttpError(503, "Email sending is not set up on this server: add RESEND_API_KEY and EMAIL_FROM to the deployment's environment.");

    const customer = order.customerId ? await ctx.store.get("customers", order.customerId) : null;
    if (customer?.erasedAt) throw new HttpError(400, "This customer's details were erased at their request, so there is nobody to write to.");
    const to = (order.customerEmail ?? customer?.email ?? "").trim().toLowerCase();
    if (!to) throw new HttpError(400, `${order.number} has no email address: add one to the order or the customer first.`);

    let shipment = null;
    if (kind === "shipped") {
      const shipments = (await ctx.store.list("shipments")).filter((s) => s.orderId === order.id).sort((a, b) => a.shippedAt.localeCompare(b.shippedAt));
      shipment = (body.shipmentId ? shipments.find((s) => s.id === body.shipmentId) : shipments[shipments.length - 1]) ?? null;
      if (!shipment) throw new HttpError(400, `${order.number} has not shipped yet.`);
    }
    const already = (order.emails ?? []).find((e) => e.kind === kind && (kind === "confirmed" || e.shipmentId === shipment?.id));
    if (already && !force) return Response.json({ ok: true, skipped: "already", sent: already });

    const items = new Map((await ctx.store.list("items")).map((i) => [i.id, { sku: i.sku, name: i.name, unit: i.unit }]));
    const mail = renderOrderEmail(kind, { order, shipment, items, settings: { companyName: settings?.companyName ?? "", currency: settings?.currency ?? "USD", notifications: settings?.notifications } });
    await sendEmail({ to, ...mail, replyTo: settings?.notifications?.replyTo, fromName: settings?.companyName });

    const entry: OrderEmail = { kind, to, subject: mail.subject, sentAt: nowIso(), sentBy: ctx.actor.id, ...(shipment ? { shipmentId: shipment.id } : {}) };
    await ctx.store.batch([
      { op: "patch", collection: "orders", id: order.id, patch: { emails: [...(order.emails ?? []), entry] } },
      activityOp(ctx.actor, "order.emailed", `${ctx.actor.name} emailed ${to} · ${mail.subject}`, { entityType: "order", entityId: order.id, meta: { kind, to, ...(shipment ? { shipmentId: shipment.id } : {}) } }),
    ]);
    return Response.json({ ok: true, sent: entry });
  } catch (e) {
    return jsonError(e);
  }
}
