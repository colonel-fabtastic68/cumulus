"use client";

import { useEffect, useMemo, useState } from "react";
import { History, Plus, Sparkles, Trash2, Workflow } from "lucide-react";
import type { AgentSession } from "@/lib/types";
import { useCollection, useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { AgentChat } from "@/components/agent/AgentPanel";
import { Button, ConfirmDialog, IconButton, useToast } from "@/components/ui";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Buckets conversations by how long ago they were touched. */
function groupByAge(recent: AgentSession[]): Array<{ label: string; sessions: AgentSession[] }> {
  const now = Date.now();
  const out: Array<{ label: string; sessions: AgentSession[] }> = [
    { label: "Today", sessions: [] },
    { label: "Last 7 days", sessions: [] },
    { label: "Last 30 days", sessions: [] },
    { label: "Older", sessions: [] },
  ];
  for (const s of recent) {
    const age = (now - new Date(s.updatedAt).getTime()) / 86_400_000;
    out[age < 1 ? 0 : age < 7 ? 1 : age < 30 ? 2 : 3]!.sessions.push(s);
  }
  return out.filter((g) => g.sessions.length);
}

/** Nimbus → Chat: the full-page conversation with a rail of saved chats. */
export default function NimbusChatPage() {
  const sessions = useCollection("agentSessions");
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const { setPageContext } = useAgent();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingSession, setPendingSession] = useState<{ id: string; nonce: number } | null>(null);
  const [newChatNonce, setNewChatNonce] = useState(0);
  const [deleting, setDeleting] = useState<AgentSession | null>(null);
  const [railOpen, setRailOpen] = useState(true);

  useEffect(() => {
    setPageContext({ page: "Nimbus chat" });
  }, [setPageContext]);

  const recent = useMemo(() => [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [sessions]);
  const groups = useMemo(() => groupByAge(recent), [recent]);

  const remove = async () => {
    if (!deleting) return;
    try {
      await store.remove("agentSessions", deleting.id);
      if (deleting.id === activeId) setNewChatNonce((n) => n + 1);
      toast("Conversation deleted", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete", "critical");
    } finally {
      setDeleting(null);
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <aside className={cn("hidden shrink-0 flex-col border-r border-border bg-surface-subdued/60 transition-[width] md:flex", railOpen ? "w-[260px]" : "w-0 overflow-hidden border-r-0")}>
        <div className="flex h-12 items-center gap-2 px-3">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Conversations</span>
          <span className="flex-1" />
          <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setNewChatNonce((n) => n + 1)}>
            New chat
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {groups.length === 0 ? (
            <p className="px-2 py-6 text-center text-[12px] text-text-tertiary">Conversations you have with Nimbus are saved here for the whole team.</p>
          ) : (
            groups.map((g) => (
              <div key={g.label} className="mb-3">
                <div className="px-2 py-1 text-[11px] font-medium text-text-tertiary">{g.label}</div>
                {g.sessions.map((s) => (
                  <div key={s.id} className={cn("group flex items-center gap-1 rounded-[var(--radius-sm)] pr-1", s.id === activeId ? "bg-surface shadow-[var(--shadow-100),0_0_0_1px_rgba(26,26,26,0.07)]" : "hover:bg-[rgba(0,0,0,0.04)]")}>
                    <button type="button" onClick={() => setPendingSession({ id: s.id, nonce: Date.now() })} className="min-w-0 flex-1 px-2 py-1.5 text-left">
                      <span className="block truncate text-[12.5px] text-text">{s.title}</span>
                      <span className="block truncate text-[11px] text-text-tertiary">
                        {s.createdByName} · {formatRelative(s.updatedAt)}
                      </span>
                    </button>
                    {canWrite(user) && (
                      <IconButton size="sm" variant="plain" aria-label="Delete conversation" icon={<Trash2 />} className="text-text-tertiary opacity-0 group-hover:opacity-100 hover:text-critical" onClick={() => setDeleting(s)} />
                    )}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
        <div className="border-t border-border px-3 py-2">
          <Button size="sm" variant="plain" icon={<Workflow />} href="/agents" className="w-full justify-start text-text-secondary">
            Automations & other agents
          </Button>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-surface">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <IconButton size="sm" variant="plain" aria-label={railOpen ? "Hide conversations" : "Show conversations"} icon={<History />} className="hidden text-text-secondary md:inline-flex" onClick={() => setRailOpen((v) => !v)} />
          <span className="flex h-6 w-6 items-center justify-center rounded-[7px] bg-accent-soft text-accent">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <span className="text-[13.5px] font-semibold">Nimbus</span>
          <span className="hidden text-[12px] text-text-tertiary sm:inline">· reads the whole workspace, proposes changes, applies them after you approve</span>
          <span className="flex-1" />
          <Button size="sm" icon={<Plus />} className="md:hidden" onClick={() => setNewChatNonce((n) => n + 1)}>
            New chat
          </Button>
        </div>
        <AgentChat variant="page" pending={null} consumePending={() => {}} pendingSession={pendingSession} consumePendingSession={() => setPendingSession(null)} pageContext={{ page: "Nimbus chat" }} newChatNonce={newChatNonce} onSessionChange={setActiveId} />
      </section>

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => void remove()} destructive title="Delete this conversation?" confirmLabel="Delete" message={<>“{deleting?.title}” is removed for everyone in the workspace. Changes Nimbus already applied are not undone.</>} />
    </div>
  );
}
