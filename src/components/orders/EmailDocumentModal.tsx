"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Send } from "lucide-react";
import type { PurchaseOrder, SalesOrder } from "@/lib/types";
import { mailtoHref, purchaseOrderEmail, salesOrderEmail } from "@/lib/documentEmail";
import { markPurchaseOrderSent } from "@/lib/purchaseOrders";
import { useCollection, useItemsById, useSettings, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/api-client";
import { useFeature } from "@/lib/useFeature";
import { formatDateTime } from "@/lib/format";
import { Button, Checkbox, Modal, TextArea, TextField, useToast } from "@/components/ui";

export type EmailTarget = { kind: "purchaseOrder"; doc: PurchaseOrder } | { kind: "order"; doc: SalesOrder };

/** Mounts only while a document is chosen, so each opening starts from that document's own recipient. */
export function EmailDocumentModal({ target, onClose }: { target: EmailTarget | null; onClose: () => void }) {
  if (!target) return null;
  return <EmailForm key={`${target.kind}:${target.doc.id}`} target={target} onClose={onClose} />;
}

/**
 * Emails a purchase order to the supplier or an order confirmation to the
 * customer (feature "documentEmail"). Hosted workspaces send through
 * cumulusOS, with replies going to the sender; local mode, or an install with
 * no mail service, opens the same message in the person's own mail app.
 */
function EmailForm({ target, onClose }: { target: EmailTarget; onClose: () => void }) {
  const items = useItemsById();
  const settings = useSettings();
  const suppliers = useCollection("suppliers");
  const store = useStore();
  const user = useCurrentUser();
  const { mode } = useSession();
  const api = useApi();
  const toast = useToast();
  const useTerms = useFeature("partNumbers");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  /** null while asking the server; false in local mode or when no mail service is configured. */
  const [canSend, setCanSend] = useState<boolean | null>(mode === "firestore" ? null : false);

  const supplier = target.kind === "purchaseOrder" ? suppliers.find((s) => s.id === target.doc.supplierId) : undefined;
  const draft = useMemo(() => {
    const ctx = { items, settings, senderName: user.name, message, useTerms };
    return target.kind === "purchaseOrder" ? purchaseOrderEmail(target.doc, { ...ctx, supplier }) : salesOrderEmail(target.doc, ctx);
  }, [target, items, settings, user.name, message, useTerms, supplier]);
  const [to, setTo] = useState(draft.to);
  const isDraftPo = target.kind === "purchaseOrder" && target.doc.status === "draft";
  const [markSent, setMarkSent] = useState(isDraftPo);
  const validTo = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(to.trim());
  const sentBefore = target.doc.emails ?? [];

  useEffect(() => {
    if (mode !== "firestore") return;
    let cancelled = false;
    fetch("/api/email/document")
      .then((r) => r.json() as Promise<{ configured?: boolean }>)
      .then((j) => !cancelled && setCanSend(!!j.configured))
      .catch(() => !cancelled && setCanSend(false));
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const send = async () => {
    setBusy(true);
    try {
      await api("/api/email/document", { kind: target.kind, id: target.doc.id, to: to.trim(), message: message.trim() || undefined, markSent });
      toast(`Emailed ${target.doc.number} to ${to.trim()}`, "success");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "The email could not be sent", "critical");
    } finally {
      setBusy(false);
    }
  };

  /** No mail service: hand the message to the person's own mail app. Nothing is recorded as sent, because we cannot know that it was. */
  const openInMailApp = async () => {
    window.location.href = mailtoHref({ ...draft, to: to.trim() });
    if (markSent && target.kind === "purchaseOrder") await markPurchaseOrderSent(store, user, target.doc.id).catch(() => {});
    onClose();
  };

  const what = target.kind === "purchaseOrder" ? "purchase order" : "order confirmation";
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Email ${target.doc.number}`}
      subtitle={canSend ? `Sent from cumulusOS in ${settings.companyName}'s name. Replies go to ${user.email || "you"}.` : canSend === false ? `Opens in your own mail app with the ${what} filled in.` : undefined}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          {canSend ? (
            <Button variant="primary" icon={<Send />} onClick={() => void send()} loading={busy} disabled={!validTo}>
              Send
            </Button>
          ) : (
            <Button variant="primary" icon={<ExternalLink />} onClick={() => void openInMailApp()} disabled={canSend === null || !validTo}>
              Open in mail app
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField label="To" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder={target.kind === "purchaseOrder" ? "orders@supplier.com" : "customer@example.com"} error={to.trim() && !validTo ? "Enter a valid email address" : undefined} help={!draft.to ? (target.kind === "purchaseOrder" ? "This supplier has no email on file. Add one on the supplier to fill this in next time." : "This order has no customer email.") : undefined} />
        <TextArea label="Add a message" hint="(optional)" value={message} onChange={(e) => setMessage(e.target.value)} rows={2} placeholder={target.kind === "purchaseOrder" ? "Please ship complete; call before delivery." : "Thanks again. We expect to ship on Friday."} />
        <div>
          <div className="mb-1 text-[12.5px] font-medium text-text">Preview</div>
          <div className="rounded-[var(--radius)] border border-border">
            <div className="border-b border-border bg-surface-subdued px-3 py-1.5 text-[12.5px] text-text-secondary">
              Subject: <span className="font-medium text-text">{draft.subject}</span>
            </div>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-3 py-2 font-sans text-[12.5px] leading-5 text-text-secondary">{draft.text}</pre>
          </div>
        </div>
        {isDraftPo && <Checkbox label="Mark the order as sent" help="A draft becomes Sent once the email goes out." checked={markSent} onChange={setMarkSent} />}
        {sentBefore.length > 0 && (
          <p className="text-[12px] text-text-tertiary">
            Emailed before: {sentBefore.slice(-3).map((e) => `${e.to} on ${formatDateTime(e.at)}`).join(" · ")}
            {sentBefore.length > 3 ? ` and ${sentBefore.length - 3} earlier` : ""}
          </p>
        )}
      </div>
    </Modal>
  );
}
