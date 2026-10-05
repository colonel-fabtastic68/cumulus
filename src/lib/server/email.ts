import { HttpError } from "@/lib/integrations/server";

/**
 * Outbound mail through Resend, from the address in EMAIL_FROM. The display
 * name can be swapped for the workspace's company so a customer sees who the
 * order is from; replies can go to the workspace's own address.
 */

export function emailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim());
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  /** Display name in place of the one in EMAIL_FROM; the address itself stays. */
  fromName?: string;
}

function addressOf(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  return (m?.[1] ?? from).trim();
}

export async function sendEmail(mail: OutgoingEmail): Promise<{ id?: string }> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!key || !from) throw new HttpError(503, "Email sending is not set up on this server: add RESEND_API_KEY and EMAIL_FROM to the deployment's environment.");
  const sender = mail.fromName?.trim() ? `${mail.fromName.replace(/[<>"\r\n]/g, "").trim()} <${addressOf(from)}>` : from;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: sender, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html, ...(mail.replyTo?.trim() ? { reply_to: [mail.replyTo.trim()] } : {}) }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    console.error("[email] Resend refused the message", res.status, (await res.text().catch(() => "")).slice(0, 300));
    throw new HttpError(502, `The email could not be sent (Resend answered ${res.status}). Check the key and that the sending domain is verified.`);
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { id: data.id };
}
