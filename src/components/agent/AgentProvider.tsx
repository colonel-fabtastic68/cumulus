"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

interface AgentContextValue {
  isOpen: boolean;
  /** True once the panel has been opened; it then stays mounted (hidden) so the conversation survives closing. */
  everOpened: boolean;
  /** Open the panel, optionally pre-filling (and immediately sending) a prompt. */
  open: (prompt?: string, opts?: { send?: boolean }) => void;
  close: () => void;
  toggle: () => void;
  /** Prompt queued by open(); consumed by the panel. */
  pending: { prompt: string; send: boolean; nonce: number } | null;
  consumePending: () => void;
  /** Open the panel on a saved conversation. */
  openSession: (sessionId: string) => void;
  pendingSession: { id: string; nonce: number } | null;
  consumePendingSession: () => void;
  /** Page context contributed by the current route (e.g. selected SKUs). */
  pageContext: { page?: string; selectedSkus?: string[] };
  setPageContext: (ctx: { page?: string; selectedSkus?: string[] }) => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);
  const [pending, setPending] = useState<AgentContextValue["pending"]>(null);
  const [pendingSession, setPendingSession] = useState<AgentContextValue["pendingSession"]>(null);
  const [pageContext, setPageContextState] = useState<AgentContextValue["pageContext"]>({});
  const nonce = useRef(0);

  const open = useCallback((prompt?: string, opts?: { send?: boolean }) => {
    setOpen(true);
    setEverOpened(true);
    if (prompt) setPending({ prompt, send: opts?.send ?? false, nonce: ++nonce.current });
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => {
    setEverOpened(true);
    setOpen((o) => !o);
  }, []);
  const consumePending = useCallback(() => setPending(null), []);
  const openSession = useCallback((id: string) => {
    setOpen(true);
    setEverOpened(true);
    setPendingSession({ id, nonce: ++nonce.current });
  }, []);
  const consumePendingSession = useCallback(() => setPendingSession(null), []);
  const setPageContext = useCallback((ctx: AgentContextValue["pageContext"]) => {
    setPageContextState((prev) => (prev.page === ctx.page && JSON.stringify(prev.selectedSkus) === JSON.stringify(ctx.selectedSkus) ? prev : ctx));
  }, []);

  const value = useMemo(
    () => ({ isOpen, everOpened, open, close, toggle, pending, consumePending, openSession, pendingSession, consumePendingSession, pageContext, setPageContext }),
    [isOpen, everOpened, open, close, toggle, pending, consumePending, openSession, pendingSession, consumePendingSession, pageContext, setPageContext],
  );
  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>;
}

export function useAgent(): AgentContextValue {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgent must be used inside <AgentProvider>");
  return ctx;
}
