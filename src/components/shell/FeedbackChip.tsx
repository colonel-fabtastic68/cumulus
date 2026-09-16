"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { MessageSquarePlus } from "lucide-react";
import { Banner, Button, Modal, Segmented, useToast } from "@/components/ui";
import { accountFetch } from "@/lib/account-fetch";
import { useSession } from "@/lib/session";

type Kind = "feedback" | "feature" | "bug";

/** Sidebar chip: a note straight to the cumulusOS team (feedback, a feature request or a bug). Hosted accounts only. */
export function FeedbackChip() {
  const session = useSession();
  const toast = useToast();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("feature");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (session.mode !== "firestore" || !session.app) return null;

  const send = async () => {
    if (!session.app) return;
    setBusy(true);
    setError(null);
    try {
      await accountFetch(session.app, "/api/feedback", { kind, message, page: pathname, workspaceId: session.workspaceId ?? undefined });
      toast("Thanks, it reached us.", "success");
      setMessage("");
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="px-3 pb-2">
        <button type="button" onClick={() => setOpen(true)} className="flex h-8 w-full items-center gap-2 rounded-full border border-border bg-surface px-3 text-[12.5px] font-medium text-text-secondary hover:bg-surface-hover hover:text-text">
          <MessageSquarePlus className="h-3.5 w-3.5" />
          Feedback &amp; requests
        </button>
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Tell us something" subtitle="Goes straight to the people building cumulusOS. We read every one." footer={<Button onClick={() => setOpen(false)}>Cancel</Button>}>
        <div className="flex flex-col gap-4">
          <Segmented value={kind} onChange={setKind} options={[{ value: "feature", label: "Request a feature" }, { value: "feedback", label: "Feedback" }, { value: "bug", label: "Something broke" }]} />
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={5} autoFocus placeholder={kind === "bug" ? "What did you do, what happened, what did you expect?" : kind === "feature" ? "What would you like cumulusOS to do, and what do you do by hand today?" : "What's working, what isn't?"} className="w-full resize-y rounded-[var(--radius-sm)] border border-border bg-surface p-3 text-[13.5px] leading-5 text-text placeholder:text-text-tertiary focus:border-accent focus:outline-none" />
          {error && <Banner tone="critical">{error}</Banner>}
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => void send()} loading={busy} disabled={message.trim().length < 3}>
              Send
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
