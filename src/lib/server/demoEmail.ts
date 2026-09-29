import type { Firestore } from "firebase-admin/firestore";
import { INTAKE_FORM_URL } from "@/lib/links";
import { mailingListId, type MailingListEntry } from "./mailingList";
import { nowIso } from "@/lib/utils";

/**
 * The note that goes out when someone opens the demo: where to come back to,
 * and the intake form whose answers steer the launch. Sent once per address,
 * best effort; a mail problem never keeps anyone out of the demo.
 */

const APP = "https://cumulusos.com";

function demoWelcomeText(): { subject: string; text: string; html: string } {
  const subject = "Your cumulusOS demo, and one favor";
  const text = [
    "Thanks for trying cumulusOS.",
    "",
    `The demo is at ${APP}/demo whenever you want to come back to it. It runs in your browser with a sample company, so change anything you like.`,
    "",
    "One favor. We are in our launch phase, and what we build first is decided by what shops like yours tell us. This form takes about five minutes:",
    INTAKE_FORM_URL,
    "",
    "It asks how you track stock today, what breaks, and what a fix would be worth. Your answers go straight to the people building the product.",
    "",
    "If you would rather talk it through, book a half hour with us at " + APP + "/book.",
    "",
    "Baker",
    "cumulusOS",
    "",
    "You are getting this because you entered your email to open the demo. We will send occasional product news; every email has a one-click way out.",
  ].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#303030;line-height:1.55;font-size:15px">
<p>Thanks for trying cumulusOS.</p>
<p>The demo is at <a href="${APP}/demo">${APP}/demo</a> whenever you want to come back to it. It runs in your browser with a sample company, so change anything you like.</p>
<p><strong>One favor.</strong> We are in our launch phase, and what we build first is decided by what shops like yours tell us. This form takes about five minutes:</p>
<p><a href="${INTAKE_FORM_URL}" style="display:inline-block;background:#1a1a1a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Tell us about your shop</a></p>
<p>It asks how you track stock today, what breaks, and what a fix would be worth. Your answers go straight to the people building the product.</p>
<p>If you would rather talk it through, <a href="${APP}/book">book a half hour with us</a>.</p>
<p>Baker<br>cumulusOS</p>
<p style="color:#8a8a8a;font-size:12.5px">You are getting this because you entered your email to open the demo. We will send occasional product news; every email has a one-click way out.</p>
</div>`;
  return { subject, text, html };
}

/** Sends the welcome once per address. Returns what happened, for the log. */
export async function sendDemoWelcome(db: Firestore, email: string): Promise<"sent" | "already" | "unconfigured" | "failed"> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim();
  if (!key || !from) return "unconfigured";
  const ref = db.doc(`mailingList/${mailingListId(email)}`);
  const snap = await ref.get();
  const entry = snap.exists ? (snap.data() as MailingListEntry) : null;
  if (entry?.demoWelcomeAt) return "already";
  const { subject, text, html } = demoWelcomeText();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [email], subject, text, html }),
  });
  if (!res.ok) {
    console.error("[demo welcome] Resend refused the message", res.status, (await res.text().catch(() => "")).slice(0, 300));
    return "failed";
  }
  await ref.set({ demoWelcomeAt: nowIso() }, { merge: true });
  return "sent";
}
