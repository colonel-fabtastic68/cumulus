import { getFirestore } from "firebase-admin/firestore";
import { CONTACT_EMAIL, DEFAULT_EMAIL_FROM } from "@/lib/contact";
import { HttpError, jsonError, readJson, requireServiceAccount } from "@/lib/integrations/server";
import { adminApp } from "@/lib/mcp/adminStore";
import { normalizeEmail, rateLimited } from "@/lib/server/mailingList";
import { newId, nowIso } from "@/lib/utils";

export const maxDuration = 30;

export type InquiryKind = "general" | "demo";

export interface InquiryRecord {
  id: string;
  kind: InquiryKind;
  name: string;
  email: string;
  company?: string;
  industry?: string;
  message: string;
  page?: string;
  createdAt: string;
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "";
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Mails the note to hello@ through Resend. Best effort: the record is already saved. */
async function notify(record: InquiryRecord): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return false;
  const from = process.env.EMAIL_FROM?.trim() || DEFAULT_EMAIL_FROM;
  const lines = [
    `Name: ${record.name}`,
    `Email: ${record.email}`,
    record.company ? `Company: ${record.company}` : null,
    record.industry ? `What they stock: ${record.industry}` : null,
    record.page ? `From: ${record.page}` : null,
    "",
    record.message,
  ].filter((l): l is string => l !== null);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [CONTACT_EMAIL],
      reply_to: record.email,
      subject: `${record.kind === "demo" ? "Demo request" : "Inquiry"} from ${record.name}${record.company ? ` · ${record.company}` : ""}`,
      text: lines.join("\n"),
      html: `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#303030;line-height:1.55;font-size:15px">${lines.map((l) => `<p>${escapeHtml(l) || "&nbsp;"}</p>`).join("")}</div>`,
    }),
  });
  if (!res.ok) console.error("[inquiry] Resend refused the message", res.status, (await res.text().catch(() => "")).slice(0, 300));
  return res.ok;
}

/**
 * A note from the site's contact form: saved for /admin and mailed to hello@.
 * Public, no account needed, rate limited by connection.
 */
export async function POST(req: Request) {
  try {
    let sa;
    try {
      sa = requireServiceAccount();
    } catch {
      throw new HttpError(503, `The form is not switched on for this install yet. Write to ${CONTACT_EMAIL} instead.`);
    }
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
    if (rateLimited(`inquiry:${ip}`, 5)) throw new HttpError(429, "Too many messages from this connection; try again in a minute.");
    const body = await readJson<Record<string, unknown>>(req);
    const email = typeof body.email === "string" ? normalizeEmail(body.email) : null;
    if (!email) throw new HttpError(400, "Enter a valid email address.");
    const name = clean(body.name, 120);
    if (name.length < 2) throw new HttpError(400, "Tell us your name.");
    const message = clean(body.message, 4000);
    if (message.length < 10) throw new HttpError(400, "A sentence or two about what you stock and what is not working is plenty.");
    const record: InquiryRecord = {
      id: newId("inq"),
      kind: body.kind === "demo" ? "demo" : "general",
      name,
      email,
      ...(clean(body.company, 120) ? { company: clean(body.company, 120) } : {}),
      ...(clean(body.industry, 160) ? { industry: clean(body.industry, 160) } : {}),
      message,
      ...(clean(body.page, 200) ? { page: clean(body.page, 200) } : {}),
      createdAt: nowIso(),
    };
    const db = getFirestore(adminApp(sa));
    await db.doc(`inquiries/${record.id}`).set(record);
    const mailed = await notify(record).catch((e) => {
      console.error("[inquiry] mail:", e);
      return false;
    });
    return Response.json({ ok: true, mailed });
  } catch (e) {
    return jsonError(e);
  }
}
