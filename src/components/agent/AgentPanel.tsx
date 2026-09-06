"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type InferUITools, type UIDataTypes, type UIMessage } from "ai";
import { ArrowUp, Check, ChevronDown, ChevronRight, History, Loader2, Plus, Sparkles, Square, X } from "lucide-react";
import { Badge, Banner, Button, IconButton, Markdown, Menu, useToast } from "@/components/ui";
import { agentTools, isWriteTool, TOOL_LABELS, type AgentToolName } from "@/lib/agent/tools";
import { describeProposal, executeTool } from "@/lib/agent/execute";
import { buildAgentContext } from "@/lib/agent/context";
import { useCollection, useSettings, useStore } from "@/lib/store/provider";
import { useCurrentUser, canWrite } from "@/lib/auth";
import type { AgentSession, Item } from "@/lib/types";
import { isLowStock } from "@/lib/inventory";
import { cn, newId, nowIso } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { useAgent } from "./AgentProvider";

export type AgentUIMessage = UIMessage<unknown, UIDataTypes, InferUITools<typeof agentTools>>;

/** Latest request body for the transport. Updated from an effect so the transport closure never reads React state during render. */
const latestBody = { context: "", userName: "", autoApprove: false };

/** Starter prompts shaped by the workspace so they never name an item that does not exist. */
function buildSuggestions(items: Item[], lowCount: number, inactivityDays: number): string[] {
  const assembly = [...items].filter((i) => i.type === "assembly" && i.bom.length > 0 && i.status === "active").sort((a, b) => b.bom.length - a.bom.length)[0];
  const category = items.find((i) => i.category === "Finished goods") ? "finished goods" : "our top-selling items";
  return [
    lowCount > 0 ? `What's below minimum (${lowCount} items) and what should I reorder this week, grouped by supplier?` : "Which items are closest to running out, given their lead times?",
    "Show me the 10 oldest batches still on the shelf and suggest what to do with them",
    `Raise the price of all ${category} by 5% and explain the margin impact before applying`,
    `Which parts haven't moved in ${inactivityDays} days and aren't in any active BOM?`,
    assembly ? `How many ${assembly.sku} can I build right now, and what's the bottleneck?` : "Which assemblies can't be built right now, and why?",
    "Project next month's demand using seasonality and tell me what to build first",
  ];
}

/** Width of the docked column: the 460px card plus 12px margins either side. */
const DOCK_WIDTH = "md:w-[484px]";
const EASE = "ease-[cubic-bezier(0.2,0.8,0.2,1)]";

/**
 * Nimbus lives in a column beside the page. Opening animates the column's
 * width so the page content shifts left smoothly while the rounded card
 * slides in from the right; closing reverses it. Below the md breakpoint
 * there is no room to push, so the card floats over the page instead.
 * Once opened, the chat stays mounted (hidden) so the conversation survives.
 */
export function AgentPanel() {
  const { isOpen, everOpened, close, pending, consumePending, pendingSession, consumePendingSession, pageContext } = useAgent();
  return (
    <div className={cn("relative w-0 shrink-0 overflow-hidden transition-[width] duration-300", EASE, isOpen ? DOCK_WIDTH : "md:w-0")}>
      {everOpened && (
        <aside
          role="complementary"
          aria-label="Nimbus"
          aria-hidden={!isOpen}
          inert={!isOpen}
          className={cn(
            "flex flex-col overflow-hidden rounded-[16px] bg-surface shadow-[var(--shadow-flyout)] transition-[transform,opacity] duration-300",
            EASE,
            "fixed inset-2 z-[70] md:absolute md:inset-y-3 md:left-3 md:z-auto md:w-[460px]",
            isOpen ? "translate-x-0 opacity-100" : "translate-x-[calc(100%+16px)] opacity-0",
          )}
        >
          <AgentChat onClose={close} pending={pending} consumePending={consumePending} pendingSession={pendingSession} consumePendingSession={consumePendingSession} pageContext={pageContext} />
        </aside>
      )}
    </div>
  );
}

interface AgentChatProps {
  onClose: () => void;
  pending: { prompt: string; send: boolean; nonce: number } | null;
  consumePending: () => void;
  pendingSession: { id: string; nonce: number } | null;
  consumePendingSession: () => void;
  pageContext: { page?: string; selectedSkus?: string[] };
}

function AgentChat({ onClose, pending, consumePending, pendingSession, consumePendingSession, pageContext }: AgentChatProps) {
  const store = useStore();
  const user = useCurrentUser();
  const settings = useSettings();
  const toast = useToast();
  const items = useCollection("items");
  const suppliers = useCollection("suppliers");
  const orders = useCollection("orders");
  const rmas = useCollection("rmas");
  const members = useCollection("members");
  const sessions = useCollection("agentSessions");
  const autoApprove = settings.agentAutoApprove && canWrite(user);
  const suggestions = useMemo(() => buildSuggestions(items, items.filter(isLowStock).length, settings.inactivityDays), [items, settings.inactivityDays]);

  const [sessionId, setSessionId] = useState(() => newId("chat"));
  const [initialMessages, setInitialMessages] = useState<AgentUIMessage[]>([]);
  const [historical, setHistorical] = useState(false);
  const [input, setInput] = useState("");
  const [needsKey, setNeedsKey] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Latest context for the request body.
  const context = useMemo(() => buildAgentContext({ items, suppliers, orders, rmas, settings: [settings], members }, pageContext), [items, suppliers, orders, rmas, settings, members, pageContext]);
  useEffect(() => {
    latestBody.context = context;
    latestBody.userName = user.name;
    latestBody.autoApprove = autoApprove;
  }, [context, user.name, autoApprove]);
  const execCtx = useMemo(() => ({ store, actor: { id: user.id, name: user.name } }), [store, user.id, user.name]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<AgentUIMessage>({
        api: "/api/agent",
        body: () => ({ ...latestBody }),
      }),
    [],
  );

  const saveSession = useCallback(
    async (msgs: AgentUIMessage[]) => {
      if (msgs.length === 0) return;
      const firstUser = msgs.find((m) => m.role === "user");
      const title = firstUser ? (firstUser.parts.find((p) => p.type === "text") as { text?: string } | undefined)?.text?.slice(0, 80) ?? "Conversation" : "Conversation";
      const existing = sessions.find((s) => s.id === sessionId);
      const doc: AgentSession = {
        id: sessionId,
        title,
        messages: JSON.parse(JSON.stringify(msgs)) as unknown[],
        createdBy: existing?.createdBy ?? user.id,
        createdByName: existing?.createdByName ?? user.name,
        createdAt: existing?.createdAt ?? nowIso(),
        updatedAt: nowIso(),
      };
      await store.put("agentSessions", doc);
    },
    [sessions, sessionId, store, user.id, user.name],
  );

  const { messages, sendMessage, status, stop, error, addToolOutput, clearError } = useChat<AgentUIMessage>({
    id: sessionId,
    messages: initialMessages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onError: (err) => {
      if (/503|GOOGLE_GENERATIVE_AI_API_KEY/.test(err.message)) setNeedsKey(true);
    },
    onFinish: ({ messages: msgs }) => {
      void saveSession(msgs);
    },
    async onToolCall({ toolCall }) {
      if (toolCall.dynamic) return;
      const name = toolCall.toolName as AgentToolName;
      if (isWriteTool(name) && !latestBody.autoApprove) return; // wait for approval
      if (isWriteTool(name) && !canWrite(user)) {
        addToolOutput({ tool: name, toolCallId: toolCall.toolCallId, state: "output-error", errorText: "Viewer role cannot make changes." });
        return;
      }
      try {
        const output = await executeTool(name, toolCall.input, execCtx);
        addToolOutput({ tool: name, toolCallId: toolCall.toolCallId, output: output as never });
      } catch (e) {
        addToolOutput({ tool: name, toolCallId: toolCall.toolCallId, state: "output-error", errorText: e instanceof Error ? e.message : String(e) });
      }
    },
  });

  const busy = status === "submitted" || status === "streaming";

  // Queue a prompt from elsewhere in the app.
  useEffect(() => {
    if (!pending) return;
    // Deferred so the queued prompt is handled as an event, not during the render pass.
    const t = setTimeout(() => {
      if (pending.send) {
        setHistorical(false);
        void sendMessage({ text: pending.prompt });
        setInput("");
      } else {
        setInput(pending.prompt);
        textareaRef.current?.focus();
      }
      consumePending();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending?.nonce]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, status]);

  const submit = () => {
    const text = input.trim();
    if (!text || busy) return;
    setHistorical(false);
    void sendMessage({ text });
    setInput("");
  };

  const newChat = () => {
    stop();
    setSessionId(newId("chat"));
    setInitialMessages([]);
    setHistorical(false);
    setInput("");
    clearError();
  };

  const loadSession = (s: AgentSession) => {
    stop();
    setSessionId(s.id);
    setInitialMessages(s.messages as AgentUIMessage[]);
    setHistorical(true);
    clearError();
  };

  // Open a saved conversation requested from elsewhere (e.g. the Agents page).
  useEffect(() => {
    if (!pendingSession) return;
    const t = setTimeout(() => {
      const s = sessions.find((x) => x.id === pendingSession.id);
      if (s) loadSession(s);
      consumePendingSession();
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSession?.nonce]);

  const approve = async (name: AgentToolName, toolCallId: string, input: unknown) => {
    try {
      const output = await executeTool(name, input, execCtx);
      addToolOutput({ tool: name, toolCallId, output: output as never });
      const summary = (output as { summary?: string })?.summary;
      if (summary) toast(summary, "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      addToolOutput({ tool: name, toolCallId, state: "output-error", errorText: msg });
      toast(msg, "critical");
    }
  };

  const reject = (name: AgentToolName, toolCallId: string) => {
    addToolOutput({ tool: name, toolCallId, output: { rejected: true, summary: "The user rejected this action. Do not retry it; ask what to change." } as never });
  };

  const recent = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 12);

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface-subdued/80 px-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-accent-soft text-accent">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[13.5px] font-semibold">Nimbus</div>
          <div className="truncate text-[11.5px] text-text-tertiary">{autoApprove ? "Auto-applies changes" : "Asks before changing data"}</div>
        </div>
        <Menu
          align="right"
          trigger={
            <IconButton variant="plain" size="sm" aria-label="History" className="text-text-secondary">
              <History className="h-4 w-4" />
            </IconButton>
          }
          items={
            recent.length
              ? recent.map((s) => ({
                  label: (
                    <span className="block min-w-0">
                      <span className="block truncate">{s.title}</span>
                      <span className="block text-[11px] text-text-tertiary">
                        {s.createdByName} · {formatRelative(s.updatedAt)}
                      </span>
                    </span>
                  ),
                  onSelect: () => loadSession(s),
                }))
              : [{ label: <span className="text-text-tertiary">No conversations yet</span>, disabled: true }]
          }
        />
        <IconButton variant="plain" size="sm" aria-label="New conversation" className="text-text-secondary" onClick={newChat}>
          <Plus className="h-4 w-4" />
        </IconButton>
        <IconButton variant="plain" size="sm" aria-label="Close" className="text-text-secondary" onClick={onClose}>
          <X className="h-4 w-4" />
        </IconButton>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {needsKey && (
          <Banner tone="warning" title="Add a Gemini API key to enable Nimbus" className="mb-3">
            Create a key at aistudio.google.com/apikey, put it in <code>.env.local</code> as <code>GOOGLE_GENERATIVE_AI_API_KEY</code>, then restart <code>npm run dev</code>.
          </Banner>
        )}
        {messages.length === 0 ? (
          <div className="flex h-full flex-col justify-end">
            <div className="mb-4">
              <div className="text-[15px] font-semibold">What should we do with the inventory?</div>
              <p className="mt-1 text-[12.5px] text-text-secondary">I can read every item, BOM and movement, run reports, and make bulk changes. Changes are shown to you first.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => { setInput(s); textareaRef.current?.focus(); }} className="rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-left text-[12.5px] text-text-secondary hover:border-border-strong hover:text-text">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {historical && <div className="text-center text-[11.5px] text-text-tertiary">Reopened conversation · pending actions from before are not re-applied</div>}
            {messages.map((m) => (
              <MessageView key={m.id} message={m} historical={historical} onApprove={approve} onReject={reject} canWrite={canWrite(user)} />
            ))}
            {status === "submitted" && (
              <div className="flex items-center gap-2 text-[12.5px] text-text-tertiary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
              </div>
            )}
            {error && !needsKey && (
              <Banner tone="critical" title="Something went wrong">
                {error.message}
              </Banner>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <div className="flex items-end gap-2 rounded-[var(--radius)] border border-border-strong/70 bg-surface p-1.5 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={Math.min(6, Math.max(1, input.split("\n").length))}
            placeholder="Ask, or tell me what to change…"
            className="max-h-40 flex-1 resize-none bg-transparent px-1.5 py-1 text-[13px] outline-none placeholder:text-text-tertiary"
          />
          {busy ? (
            <IconButton variant="secondary" size="sm" aria-label="Stop" onClick={() => stop()}>
              <Square className="h-3 w-3" />
            </IconButton>
          ) : (
            <IconButton variant="primary" size="sm" aria-label="Send" onClick={submit} disabled={!input.trim()}>
              <ArrowUp className="h-3.5 w-3.5" />
            </IconButton>
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[11px] text-text-tertiary">
          <span>Enter to send · Shift+Enter for a new line</span>
          <span>Gemini Flash</span>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function MessageView({ message, historical, onApprove, onReject, canWrite }: { message: AgentUIMessage; historical: boolean; onApprove: (name: AgentToolName, id: string, input: unknown) => void; onReject: (name: AgentToolName, id: string) => void; canWrite: boolean }) {
  if (message.role === "user") {
    const text = message.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-[var(--radius)] rounded-br-[4px] bg-primary px-3 py-2 text-[13px] text-white">{text}</div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {message.parts.map((part, i) => {
        if (part.type === "text") return part.text.trim() ? <Markdown key={i} text={part.text} /> : null;
        if (part.type.startsWith("tool-")) {
          const name = part.type.slice(5) as AgentToolName;
          const tp = part as unknown as ToolPartShape;
          return <ToolPartView key={tp.toolCallId ?? i} name={name} part={tp} historical={historical} onApprove={onApprove} onReject={onReject} canWrite={canWrite} />;
        }
        return null;
      })}
    </div>
  );
}

interface ToolPartShape {
  toolCallId: string;
  state: "input-streaming" | "input-available" | "output-available" | "output-error" | "approval-requested" | "approval-responded" | "output-denied";
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

function ToolPartView({ name, part, historical, onApprove, onReject, canWrite }: { name: AgentToolName; part: ToolPartShape; historical: boolean; onApprove: (name: AgentToolName, id: string, input: unknown) => void; onReject: (name: AgentToolName, id: string) => void; canWrite: boolean }) {
  const write = isWriteTool(name);
  const label = TOOL_LABELS[name] ?? name;
  if (!write) return <ReadToolChip label={label} part={part} />;
  return <ProposalCard name={name} label={label} part={part} historical={historical} onApprove={onApprove} onReject={onReject} canWrite={canWrite} />;
}

function ReadToolChip({ label, part }: { label: string; part: ToolPartShape }) {
  const [open, setOpen] = useState(false);
  const done = part.state === "output-available";
  const err = part.state === "output-error";
  const count = done ? countResults(part.output) : null;
  return (
    <div className="text-[12px]">
      <button type="button" onClick={() => setOpen((o) => !o)} className={cn("inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-text-secondary hover:bg-surface-hover", err && "border-critical/30 text-critical")}>
        {done || err ? open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" /> : <Loader2 className="h-3 w-3 animate-spin" />}
        {label}
        {count !== null && <span className="text-text-tertiary">· {count}</span>}
        {err && <span>· failed</span>}
      </button>
      {open && (
        <pre className="mt-1 max-h-64 overflow-auto rounded-[6px] bg-surface-hover p-2 font-mono text-[11px] text-text-secondary">
          {JSON.stringify({ input: part.input, output: part.output ?? part.errorText }, null, 2)}
        </pre>
      )}
    </div>
  );
}

function countResults(output: unknown): number | string | null {
  if (Array.isArray(output)) return output.length;
  if (output && typeof output === "object") {
    const o = output as Record<string, unknown>;
    if (typeof o.total === "number") return o.total;
    if (typeof o.matched === "number") return `${o.matched} matched`;
    if (Array.isArray(o.items)) return o.items.length;
    if (Array.isArray(o.requirements)) return `${o.requirements.length} parts`;
  }
  return null;
}

function ProposalCard({ name, label, part, historical, onApprove, onReject, canWrite }: { name: AgentToolName; label: string; part: ToolPartShape; historical: boolean; onApprove: (name: AgentToolName, id: string, input: unknown) => void; onReject: (name: AgentToolName, id: string) => void; canWrite: boolean }) {
  const store = useStore();
  const user = useCurrentUser();
  const [desc, setDesc] = useState<Awaited<ReturnType<typeof describeProposal>> | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [applying, setApplying] = useState(false);
  const pending = part.state === "input-available";

  // Describe the proposal once the input is complete and keep that description:
  // re-describing after the tool ran would diff against the already-changed store.
  const described = useRef(false);
  useEffect(() => {
    if (part.state === "input-streaming" || described.current) return;
    described.current = true;
    let cancelled = false;
    describeProposal(name, part.input, { store, actor: { id: user.id, name: user.name } }).then((d) => {
      if (!cancelled) setDesc(d);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, part.state, store]);

  const out = part.output as { ok?: boolean; summary?: string; rejected?: boolean } | undefined;
  const tone = part.state === "output-error" ? "critical" : out?.rejected ? "default" : part.state === "output-available" ? "success" : "warning";
  const destructive = name === "deleteItems";

  return (
    <div className={cn("rounded-[var(--radius)] border bg-surface", pending ? "border-warning/40 shadow-[0_0_0_3px_var(--warning-soft)]" : "border-border")}>
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Badge tone={tone}>{part.state === "input-streaming" ? "Preparing" : pending ? "Needs approval" : out?.rejected ? "Rejected" : part.state === "output-error" ? "Failed" : "Applied"}</Badge>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-text">{desc?.title ?? label}</span>
      </div>
      <div className="px-3 py-2 text-[12.5px]">
        {desc?.lines?.length ? (
          <ul className="list-disc space-y-0.5 pl-4 text-text-secondary">
            {desc.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        ) : null}
        {desc?.affected && desc.affected.length > 0 && (
          <div className="mt-2 overflow-x-auto rounded-[6px] border border-border">
            <table className="w-full text-[11.5px]">
              <thead className="bg-surface-subdued text-text-secondary">
                <tr>
                  <th className="px-2 py-1 text-left font-medium">SKU</th>
                  <th className="px-2 py-1 text-left font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {(showAll ? desc.affected : desc.affected.slice(0, 6)).map((a) => (
                  <tr key={a.sku} className="border-t border-border">
                    <td className="px-2 py-1 font-mono">{a.sku}</td>
                    <td className="px-2 py-1 text-text-secondary">
                      {a.changes && Object.keys(a.changes).length
                        ? Object.entries(a.changes)
                            .map(([k, v]) => `${k}: ${fmt(v.from)} → ${fmt(v.to)}`)
                            .join(" · ")
                        : "no change"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {desc.affected.length > 6 && (
              <button type="button" onClick={() => setShowAll((s) => !s)} className="w-full border-t border-border px-2 py-1 text-left text-[11.5px] text-accent hover:bg-surface-hover">
                {showAll ? "Show fewer" : `Show all ${desc.affected.length}`}
              </button>
            )}
          </div>
        )}
        {part.state === "output-error" && <div className="mt-1 text-critical">{part.errorText}</div>}
        {part.state === "output-available" && out?.summary && <div className={cn("mt-1 flex items-center gap-1", out.rejected ? "text-text-tertiary" : "text-success")}>{!out.rejected && <Check className="h-3.5 w-3.5" />}{out.summary}</div>}
      </div>
      {pending && (
        <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
          {historical ? (
            <span className="text-[12px] text-text-tertiary">Not applied — conversation was reopened</span>
          ) : !canWrite ? (
            <span className="text-[12px] text-text-tertiary">Viewers can&apos;t apply changes</span>
          ) : (
            <>
              <Button size="sm" onClick={() => onReject(name, part.toolCallId)} disabled={applying}>
                Reject
              </Button>
              <Button
                size="sm"
                variant={destructive ? "critical" : "primary"}
                loading={applying}
                onClick={async () => {
                  setApplying(true);
                  await onApprove(name, part.toolCallId, part.input);
                  setApplying(false);
                }}
              >
                {destructive ? "Delete" : "Apply"}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function fmt(v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (Array.isArray(v)) return v.length ? v.join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
