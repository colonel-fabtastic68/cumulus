import type { DocumentEmail } from "@/lib/types";
import { HttpError, authenticate, jsonError, readJson } from "@/lib/integrations/server";
import { activityOp } from "@/lib/inventory";
import { purchaseOrderEmail, salesOrderEmail, type EmailDocumentKind } from "@/lib/documentEmail";
import { serverFeatureEnabled } from "@/lib/features";
import { normalizeEmail, rateLimited } from "@/lib/server/mailingList";
import { CONTACT_EMAIL, DEFAULT_EMAIL_FROM } from "@/lib/contact";
import { nowIso } from "@/lib/utils";

export const maxDuration = 30;

interface Body {
  kind?: EmailDocumentKind;
  id?: string;
  to?: string;
  message?: string;
  /** Purchase orders: a draft becomes "sent" once the email has gone out. */
  markSent?: boolean;
}

/** Whether this deployment can send mail (the client falls back to the person's own mail app when it cannot). */
export async function GET() {
  return Response.json({ configured: !!process.env.RESEND_API_KEY?.trim() });
}

/**
 * Emails a purchase order to its supplier or an order confirmation to its
 * customer (feature "documentEmail"). The message is built on the server from
 * the stored document, so a caller can only choose the recipient and add a
 * note; replies go to the member who sent it.
 */
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req, { write: true });
    const body = await readJson<Body>(req);
    const settings = await ctx.store.get("settings", "default");
    if (!settings) throw new HttpError(409, "This workspace has no settings yet.");
    if (!serverFeatureEnabled("documentEmail", settings.features)) throw new HttpError(404, "Emailing orders is not switched on for this workspace.");
    const key = process.env.RESEND_API_KEY?.trim();
    if (!key) throw new HttpError(503, "This install has no mail service configured.");
    if (body.kind !== "purchaseOrder" && body.kind !== "order") throw new HttpError(400, "Unknown document type.");
    if (!body.id) throw new HttpError(400, "Missing document.");
    const to = normalizeEmail(body.to ?? "");
    if (!to) throw new HttpError(400, "Enter a valid email address to send to.");
    if (rateLimited(`docmail:${ctx.workspaceId}`, 20, 60_000)) throw new HttpError(429, "Too many emails in a minute; wait a moment and try again.");
    const message = typeof body.message === "string" ? body.message.slice(0, 2000) : undefined;
    const items = new Map((await ctx.store.list("items")).map((i) => [i.id, i]));
    const useTerms = serverFeatureEnabled("partNumbers", settings.features);
    const common = { items, settings, senderName: ctx.member.name, message, useTerms };

    const from = process.env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;
    const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
    const company = settings.companyName.replace(/["<>\r\n]/g, "").trim() || "cumulusOS";
    const send = async (draft: { subject: string; text: string; html: string }) => {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        // Sent in the company's name from the cumulusOS address; replies go to the person who sent it.
        body: JSON.stringify({ from: `"${company} via cumulusOS" <${address}>`, to: [to], reply_to: ctx.member.email || CONTACT_EMAIL, subject: draft.subject, text: draft.text, html: draft.html }),
      });
      if (!res.ok) {
        console.error("[document email] Resend refused the message", res.status, (await res.text().catch(() => "")).slice(0, 300));
        throw new HttpError(502, "The mail service refused the message. Nothing was sent.");
      }
    };
    const at = nowIso();

    if (body.kind === "purchaseOrder") {
      const po = await ctx.store.get("purchaseOrders", body.id);
      if (!po) throw new HttpError(404, "Purchase order not found.");
      if (po.status === "cancelled" || po.status === "merged") throw new HttpError(409, `${po.number} is ${po.status} and cannot be sent.`);
      const supplier = po.supplierId ? ((await ctx.store.get("suppliers", po.supplierId)) ?? undefined) : undefined;
      const draft = purchaseOrderEmail(po, { ...common, supplier });
      await send(draft);
      const log: DocumentEmail = { to, subject: draft.subject, at, by: ctx.member.id };
      const becomesSent = !!body.markSent && po.status === "draft";
      await ctx.store.batch([
        { op: "patch", collection: "purchaseOrders", id: po.id, patch: { emails: [...(po.emails ?? []), log], updatedAt: at, ...(becomesSent ? { status: "sent" as const, sentAt: at } : {}) } },
        activityOp(ctx.actor, "po.emailed", `${ctx.actor.name} emailed ${po.number} to ${to}`, { entityType: "purchaseOrder", entityId: po.id, meta: { to } }),
      ]);
      return Response.json({ ok: true, sentTo: to, status: becomesSent ? "sent" : po.status });
    }

    const order = await ctx.store.get("orders", body.id);
    if (!order) throw new HttpError(404, "Order not found.");
    const draft = salesOrderEmail(order, common);
    await send(draft);
    const log: DocumentEmail = { to, subject: draft.subject, at, by: ctx.member.id };
    await ctx.store.batch([
      { op: "patch", collection: "orders", id: order.id, patch: { emails: [...(order.emails ?? []), log] } },
      activityOp(ctx.actor, "order.emailed", `${ctx.actor.name} emailed ${order.number} to ${to}`, { entityType: "order", entityId: order.id, meta: { to } }),
    ]);
    return Response.json({ ok: true, sentTo: to, status: order.status });
  } catch (e) {
    return jsonError(e);
  }
}
