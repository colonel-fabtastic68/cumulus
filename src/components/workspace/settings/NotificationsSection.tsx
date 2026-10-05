"use client";

import { useMemo, useState } from "react";
import type { NotificationSettings, WorkspaceSettings } from "@/lib/types";
import { getRuntimeConfig } from "@/lib/firebase-config";
import { useSession } from "@/lib/session";
import { sampleOrderEmail } from "@/lib/orderEmails";
import { Banner, Segmented, TextArea, TextField, Toggle, useToast } from "@/components/ui";
import { SettingsCard } from "./SettingsCard";
import { useSaveSettings } from "./useSaveSettings";
import { useUnsavedChanges } from "./useUnsavedChanges";

const EMPTY: Required<Pick<NotificationSettings, "orderConfirmed" | "orderShipped" | "replyTo" | "signature">> = { orderConfirmed: false, orderShipped: false, replyTo: "", signature: "" };

function fromSettings(settings: WorkspaceSettings) {
  const n = settings.notifications ?? {};
  return { orderConfirmed: n.orderConfirmed === true, orderShipped: n.orderShipped === true, replyTo: n.replyTo ?? "", signature: n.signature ?? "" };
}

/** Which order emails go to customers on their own, where replies land, and how they sign off, with a preview of each. */
export function NotificationsSection({ settings, readOnly }: { settings: WorkspaceSettings; readOnly: boolean }) {
  const saveSettings = useSaveSettings();
  const toast = useToast();
  const { mode } = useSession();
  const configured = !!getRuntimeConfig().email;
  const [form, setForm] = useState(() => ({ ...EMPTY, ...fromSettings(settings) }));
  const [saving, setSaving] = useState(false);
  const [previewKind, setPreviewKind] = useState<"confirmed" | "shipped">("shipped");
  const dirty = JSON.stringify(form) !== JSON.stringify({ ...EMPTY, ...fromSettings(settings) });
  useUnsavedChanges(dirty);

  const preview = useMemo(() => sampleOrderEmail(previewKind, { companyName: settings.companyName, currency: settings.currency, notifications: { ...form, replyTo: form.replyTo || undefined, signature: form.signature || undefined } }), [previewKind, settings.companyName, settings.currency, form]);

  const save = async () => {
    const replyTo = form.replyTo.trim();
    if (replyTo && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(replyTo)) return toast("Enter a valid reply-to address, or leave it blank.", "critical");
    setSaving(true);
    try {
      await saveSettings({ notifications: { orderConfirmed: form.orderConfirmed, orderShipped: form.orderShipped, replyTo: replyTo || undefined, signature: form.signature.trim() || undefined } });
      toast("Notification settings saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "critical");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsCard onSave={() => void save()} saving={saving} dirty={dirty} readOnly={readOnly} footerNote="Every email is recorded on its order, and the buttons on an order can send one by hand at any time.">
      {mode !== "firestore" ? (
        <Banner tone="info" title="Emails go out from the hosted version">
          This install runs in local mode with nothing on a server, so there is nowhere to send mail from. The settings below are kept for when the workspace is hosted.
        </Banner>
      ) : configured ? (
        <Banner tone="success" title="Email sending is set up on this server">
          Messages go out from the address in EMAIL_FROM with your company name as the sender.
        </Banner>
      ) : (
        <Banner tone="warning" title="Email sending is not set up on this server yet">
          Add RESEND_API_KEY and EMAIL_FROM to the deployment&apos;s environment (a Resend key and a sender on a domain verified there). Until then the toggles below do nothing.
        </Banner>
      )}
      <div className="flex flex-col gap-3">
        <Toggle label="Email the customer when an order is created" help="A confirmation with the lines, the total and the shipping address, sent as soon as the order is saved with an email address on it." checked={form.orderConfirmed} onChange={(v) => setForm((f) => ({ ...f, orderConfirmed: v }))} disabled={readOnly} />
        <Toggle label="Email the customer when a shipment goes out" help="What shipped, the carrier and the tracking number, sent from the ship step and from bought labels. Partial shipments say what is still to come." checked={form.orderShipped} onChange={(v) => setForm((f) => ({ ...f, orderShipped: v }))} disabled={readOnly} />
      </div>
      <TextField label="Reply-to address" hint="(optional)" type="email" value={form.replyTo} onChange={(e) => setForm((f) => ({ ...f, replyTo: e.target.value }))} placeholder="orders@yourcompany.com" help="Customers who reply reach this inbox instead of the sending address." disabled={readOnly} containerClassName="sm:max-w-[360px]" />
      <TextArea label="Sign-off" hint="(optional)" value={form.signature} onChange={(e) => setForm((f) => ({ ...f, signature: e.target.value }))} placeholder={"Questions? Reply to this email or call (503) 555-0142.\nMon–Fri 8–5 Pacific"} help="Closing lines under every email, above your company name." rows={3} disabled={readOnly} />
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12.5px] font-medium text-text">Preview</span>
          <Segmented value={previewKind} onChange={setPreviewKind} options={[{ value: "confirmed", label: "Confirmation" }, { value: "shipped", label: "Shipping update" }]} />
        </div>
        <div className="rounded-[var(--radius)] border border-border bg-surface-subdued p-3">
          <div className="text-[12.5px] font-medium text-text">Subject: {preview.subject}</div>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-[12.5px] leading-5 text-text-secondary">{preview.text}</pre>
        </div>
      </div>
    </SettingsCard>
  );
}
