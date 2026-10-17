"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { CalendarClock, LifeBuoy, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { Banner, Button, Modal, useToast } from "@/components/ui";
import { useAgent } from "@/components/agent/AgentProvider";
import { accountFetch } from "@/lib/account-fetch";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

const STRATO_PROMPT = (where: string) =>
  `I'm setting up my cumulusOS workspace (${where}). Walk me through what to do here: how to get my inventory out of what I use today, what to put in the spreadsheet, and what to check before importing. Ask me what I use first.`;

/**
 * Floating Help for the guided setup: ask Strato in the chat panel, send the
 * team a message straight from here, or book a call. Hosted accounts can
 * message; a local install only has Strato.
 */
export function HelpButton({ where }: { where: string }) {
  const { open: openAgent, isOpen: agentOpen } = useAgent();
  const session = useSession();
  const toast = useToast();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const hosted = session.mode === "firestore" && !!session.app;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const askStrato = () => {
    setOpen(false);
    openAgent(STRATO_PROMPT(where), { send: true });
  };

  const send = async () => {
    if (!session.app) return;
    setBusy(true);
    setError(null);
    try {
      await accountFetch(session.app, "/api/feedback", { kind: "feedback", message: `[Setup help · ${where}] ${message.trim()}`, page: pathname, workspaceId: session.workspaceId ?? undefined });
      toast("Sent. We answer by email, usually the same day.", "success");
      setMessage("");
      setContact(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* Sits above the sticky Continue bar on phones; beside the page on wider screens, shifting left when Strato's column is open. */}
      <div ref={ref} className={cn("fixed bottom-[76px] right-4 z-[60] flex flex-col items-end gap-2 transition-transform duration-300 sm:bottom-4", agentOpen && "md:-translate-x-[484px]")}>
        {open && (
          <div className="animate-menu w-[min(320px,calc(100vw-32px))] rounded-[var(--radius)] border border-border bg-surface p-2 shadow-[var(--shadow-flyout)]" role="menu" aria-label="Help">
            <div className="px-2 pb-2 pt-1.5 text-[12.5px] text-text-secondary">Stuck on this step? Pick whichever is fastest.</div>
            <HelpItem icon={<Sparkles className="text-magic" />} title="Ask Strato" hint="Answers right here, knows your workspace" onClick={askStrato} />
            {hosted ? (
              <HelpItem
                icon={<MessageCircle />}
                title="Message the team"
                hint="A note straight to us; we reply by email"
                onClick={() => {
                  setOpen(false);
                  setContact(true);
                }}
              />
            ) : (
              <HelpItem icon={<MessageCircle />} title="Message the team" hint="Available on hosted accounts" disabled />
            )}
            <HelpItem icon={<CalendarClock />} title="Book a setup call" hint="Twenty minutes with a founder, free" href="/book" onClick={() => setOpen(false)} />
          </div>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="menu"
          className="flex h-12 items-center gap-2 rounded-full border border-border bg-surface pl-3.5 pr-4 text-[13.5px] font-medium text-text shadow-[var(--shadow-flyout)] transition-colors hover:bg-surface-hover"
        >
          {open ? <X className="h-4 w-4" /> : <LifeBuoy className="h-4 w-4" />}
          Help
        </button>
      </div>

      <Modal open={contact} onClose={() => setContact(false)} title="Message the team" subtitle="Tell us where you are stuck. It reaches the people building cumulusOS, and we answer by email." footer={<Button onClick={() => setContact(false)}>Cancel</Button>}>
        <div className="flex flex-col gap-4">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            autoFocus
            placeholder="What are you trying to do, and what is in the way? Mention the app your data is in if that is the sticking point."
            className="w-full resize-y rounded-[var(--radius-sm)] border border-border bg-surface p-3 text-[13.5px] leading-5 text-text placeholder:text-text-tertiary focus:border-accent focus:outline-none"
          />
          {error && <Banner tone="critical">{error}</Banner>}
          <div className="flex items-center justify-between gap-3">
            <Button variant="plain" href="/book" icon={<CalendarClock />}>
              Book a call instead
            </Button>
            <Button variant="primary" icon={<Send />} onClick={() => void send()} loading={busy} disabled={message.trim().length < 3}>
              Send
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function HelpItem({ icon, title, hint, onClick, href, disabled }: { icon: React.ReactNode; title: string; hint: string; onClick?: () => void; href?: string; disabled?: boolean }) {
  const cls = cn("flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-2 py-2 text-left transition-colors", disabled ? "cursor-not-allowed opacity-50" : "hover:bg-surface-hover");
  const body = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-subdued text-text-secondary [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium text-text">{title}</span>
        <span className="block text-[12px] text-text-secondary">{hint}</span>
      </span>
    </>
  );
  if (href && !disabled)
    return (
      <a href={href} target="_blank" rel="noreferrer" onClick={onClick} className={cls} role="menuitem">
        {body}
      </a>
    );
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls} role="menuitem">
      {body}
    </button>
  );
}
