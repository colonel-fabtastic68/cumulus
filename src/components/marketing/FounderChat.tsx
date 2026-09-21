"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { MessageCircle, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";

const STARTERS = ["What does cumulusOS do?", "How does Strato work?", "What does it cost?", "Which stores and carriers connect?"];

/** Floating "Ask Baker's assistant" on the marketing pages: a small Gemini-backed chat that only knows the product. */
export function FounderChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, error, clearError } = useChat<UIMessage>({ transport: new DefaultChatTransport({ api: "/api/chat/founder" }) });
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  const ask = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    clearError();
    setInput("");
    void sendMessage({ text: t });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="founder-chat"
        className="fixed bottom-5 right-5 z-[70] inline-flex h-12 items-center gap-2 rounded-full bg-primary px-4 text-[14px] font-medium text-text-inverse shadow-[var(--shadow-pop)] hover:opacity-95"
      >
        {open ? <X className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
        {open ? "Close" : "Ask about cumulusOS"}
      </button>
      {open && (
        <section id="founder-chat" aria-label="Chat with Baker's assistant" className="animate-menu fixed bottom-20 right-5 z-[70] flex h-[min(560px,calc(100dvh-7rem))] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-border bg-surface shadow-[var(--shadow-pop)]">
          <header className="border-b border-border px-4 py-3">
            <div className="text-[14px] font-semibold text-text">Baker&apos;s assistant</div>
            <p className="text-[12px] text-text-secondary">An AI that answers for Baker Cobb, the founder. For the real Baker, book a demo.</p>
          </header>
          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[13px] text-text-secondary">Ask anything about what cumulusOS does, how Strato works, pricing, or connections.</p>
                {STARTERS.map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-border bg-surface px-3 py-1.5 text-left text-[12.5px] text-text hover:bg-surface-hover">
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={cn("max-w-[88%] whitespace-pre-wrap rounded-[12px] px-3 py-2 text-[13.5px] leading-5", m.role === "user" ? "ml-auto bg-primary text-text-inverse" : "bg-surface-subdued text-text")}>
                {m.parts.map((p, i) => (p.type === "text" ? <span key={i}>{p.text}</span> : null))}
              </div>
            ))}
            {busy && messages[messages.length - 1]?.role === "user" && <div className="w-fit rounded-[12px] bg-surface-subdued px-3 py-2 text-[13px] text-text-tertiary">Thinking…</div>}
            {error && <p className="text-[12.5px] text-critical">{error.message}</p>}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
            className="flex items-center gap-2 border-t border-border p-2.5"
          >
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type a question" aria-label="Your question" className="h-9 flex-1 rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-[13.5px] text-text outline-none focus:border-accent" disabled={busy} />
            <button type="submit" aria-label="Send" disabled={busy || !input.trim()} className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] bg-primary text-text-inverse disabled:opacity-40">
              <Send className="h-4 w-4" />
            </button>
          </form>
          <p className="px-4 pb-2 text-[11px] text-text-tertiary">
            Want the human version? <a href="/demo" className="text-accent hover:underline">Book a demo</a>.
          </p>
        </section>
      )}
    </>
  );
}
