"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { Member } from "@/lib/types";
import { isOnline, useAuth } from "@/lib/auth";
import { debugLog } from "@/lib/debug";
import { CLOSE, PRESENCE_HIDDEN_DISCONNECT_MS, freshPeers, reconnectDelay, summarize, type PresencePeer, type PresenceSummary, type PresenceView, type ServerMessage } from "@/lib/presence";
import { useSession } from "@/lib/session";
import { getFirebaseAuth } from "@/lib/store/firestore";
import { useFeature } from "@/lib/useFeature";

/**
 * Live presence for the open workspace (src/lib/presence.ts). Hosted
 * workspaces hold a WebSocket to /api/presence; local mode shares sessions
 * between this browser's tabs. While nothing live is connected (the feature
 * is off, the server cannot hold sockets, or the connection is down) every
 * check falls back to the members' last-seen heartbeat, as before.
 */

interface PresenceContextValue {
  /** A live feed is connected, so `summary` is the truth about who is online. */
  live: boolean;
  summary: PresenceSummary;
  register: (key: string) => () => void;
}

const EMPTY: PresenceSummary = { online: new Set(), here: [], editing: new Map() };
const PresenceContext = createContext<PresenceContextValue>({ live: false, summary: EMPTY, register: () => () => {} });

interface Transport {
  send(view: PresenceView): void;
  close(): void;
}

interface Handlers {
  view: () => PresenceView;
  onWelcome: (sessionId: string, peers: PresencePeer[]) => void;
  onPeers: (peers: PresencePeer[]) => void;
  onDown: () => void;
}

export function PresenceProvider({ children }: { children: ReactNode }) {
  const enabled = useFeature("livePresence");
  const session = useSession();
  const { user, mode } = useAuth();
  const pathname = usePathname() ?? "/";
  const [editingKeys, setEditingKeys] = useState<string[]>([]);
  const [feed, setFeed] = useState<{ live: boolean; sessionId: string | null; peers: PresencePeer[] }>({ live: false, sessionId: null, peers: [] });
  const hidden = useHiddenTooLong();
  const view = useMemo<PresenceView>(() => ({ path: pathname, editing: editingKeys.at(-1) ?? null }), [pathname, editingKeys]);
  const viewRef = useRef(view);
  const transport = useRef<Transport | null>(null);

  const memberId = user?.id ?? null;
  const workspaceId = session.workspaceId;
  const app = session.app;
  const active = enabled && !!memberId && !!workspaceId && !hidden;

  useEffect(() => {
    if (!active || !memberId || !workspaceId) return;
    const handlers: Handlers = {
      view: () => viewRef.current,
      onWelcome: (sessionId, peers) => setFeed({ live: true, sessionId, peers }),
      onPeers: (peers) => setFeed((f) => ({ ...f, peers })),
      onDown: () => setFeed((f) => ({ ...f, live: false })),
    };
    const t =
      mode === "local"
        ? startTabs(memberId, workspaceId, handlers)
        : app
          ? startSocket(workspaceId, async () => {
              const current = getFirebaseAuth(app).currentUser;
              if (!current) throw new Error("Signed out");
              return current.getIdToken();
            }, handlers)
          : null;
    transport.current = t;
    return () => {
      t?.close();
      transport.current = null;
      setFeed({ live: false, sessionId: null, peers: [] });
    };
  }, [active, mode, app, memberId, workspaceId]);

  // Tell the others when this tab moves to another screen or opens an edit form.
  useEffect(() => {
    viewRef.current = view;
    const t = setTimeout(() => transport.current?.send(view), 250);
    return () => clearTimeout(t);
  }, [view]);

  const register = useCallback((key: string) => {
    setEditingKeys((keys) => [...keys, key]);
    return () =>
      setEditingKeys((keys) => {
        const i = keys.lastIndexOf(key);
        return i < 0 ? keys : [...keys.slice(0, i), ...keys.slice(i + 1)];
      });
  }, []);

  const summary = useMemo(() => (feed.live ? summarize(feed.peers, feed.sessionId, memberId, pathname) : EMPTY), [feed, memberId, pathname]);
  const value = useMemo<PresenceContextValue>(() => ({ live: feed.live, summary, register }), [feed.live, summary, register]);
  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}

/** Whether a member is online: live sessions when connected, else the last-seen heartbeat. */
export function useOnlineCheck(): (member: Member) => boolean {
  const { live, summary } = useContext(PresenceContext);
  return useCallback((member: Member) => (live ? summary.online.has(member.id) : isOnline(member)), [live, summary]);
}

/** Other members on this same screen right now (empty unless live). */
export function usePeopleHere(): string[] {
  return useContext(PresenceContext).summary.here;
}

/**
 * Marks this tab as editing `key` (see recordKey) while the caller is mounted,
 * and returns the other members editing the same record. Pass null to only
 * listen, e.g. while creating a new record.
 */
export function useEditingPresence(key: string | null): string[] {
  const { register, summary } = useContext(PresenceContext);
  useEffect(() => (key ? register(key) : undefined), [key, register]);
  return key ? (summary.editing.get(key) ?? []) : [];
}

/** True once the tab has been hidden for a while: a background tab lets go of its connection. */
function useHiddenTooLong(): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (document.visibilityState === "hidden") timer = setTimeout(() => setHidden(true), PRESENCE_HIDDEN_DISCONNECT_MS);
      else setHidden(false);
    };
    document.addEventListener("visibilitychange", onChange);
    return () => {
      document.removeEventListener("visibilitychange", onChange);
      if (timer) clearTimeout(timer);
    };
  }, []);
  return hidden;
}

// ---- hosted: a WebSocket to /api/presence ---------------------------------

/** Never connected after this many tries: this server cannot hold sockets (e.g. `next dev`), so stop until the page reloads. */
const GIVE_UP_AFTER = 4;

function startSocket(workspaceId: string, getToken: () => Promise<string>, h: Handlers): Transport {
  let ws: WebSocket | null = null;
  let stopped = false;
  let failures = 0;
  let welcomed = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;
  const url = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/presence`;

  const later = () => {
    if (stopped) return;
    retry = setTimeout(() => void connect(), reconnectDelay(failures));
  };

  const connect = async () => {
    if (stopped) return;
    let token: string;
    try {
      token = await getToken();
    } catch {
      failures++;
      return later();
    }
    if (stopped) return;
    const sock = new WebSocket(url);
    ws = sock;
    sock.onopen = () => {
      sock.send(JSON.stringify({ type: "hello", token, workspaceId, view: h.view() }));
      ping = setInterval(() => {
        if (sock.readyState === WebSocket.OPEN) sock.send('{"type":"ping"}');
      }, 25_000);
    };
    sock.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "welcome") {
        welcomed = true;
        failures = 0;
        h.onWelcome(msg.sessionId, msg.peers);
      } else if (msg.type === "peers") h.onPeers(msg.peers);
    };
    sock.onclose = (ev) => {
      if (ping) clearInterval(ping);
      ping = null;
      ws = null;
      h.onDown();
      if (stopped) return;
      // Refused for who this is, not for the network: retrying will not help (an expired token is fetched afresh, so that one is retried).
      if (ev.code === CLOSE.notMember || ev.code === CLOSE.notSetUp || ev.code === CLOSE.badMessage || (ev.code === CLOSE.signIn && !welcomed)) {
        debugLog(`presence: refused (${ev.code} ${ev.reason})`);
        return;
      }
      failures++;
      if (!welcomed && failures >= GIVE_UP_AFTER) {
        debugLog("presence: this server does not hold WebSockets; using the heartbeat");
        return;
      }
      later();
    };
  };

  void connect();
  return {
    send(view) {
      if (ws?.readyState === WebSocket.OPEN && welcomed) ws.send(JSON.stringify({ type: "view", view }));
    },
    close() {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (ping) clearInterval(ping);
      ws?.close(CLOSE.normal);
    },
  };
}

// ---- local mode: this browser's tabs ----------------------------------------

type TabMessage = { type: "here"; peer: PresencePeer } | { type: "bye"; sessionId: string } | { type: "who" };

function startTabs(memberId: string, workspaceId: string, h: Handlers): Transport {
  if (typeof BroadcastChannel === "undefined") return { send() {}, close() {} };
  const channel = new BroadcastChannel(`cumulus:presence:${workspaceId}`);
  const sessionId = Math.random().toString(36).slice(2, 12);
  const since = Date.now();
  const others = new Map<string, PresencePeer>();
  const me = (): PresencePeer => ({ sessionId, memberId, ...h.view(), since, seenAt: Date.now() });
  const emit = () => h.onPeers(freshPeers([me(), ...others.values()], Date.now()));
  const announce = () => channel.postMessage({ type: "here", peer: me() } satisfies TabMessage);
  const bye = () => channel.postMessage({ type: "bye", sessionId } satisfies TabMessage);

  channel.onmessage = (ev: MessageEvent<TabMessage>) => {
    const m = ev.data;
    if (m.type === "here") others.set(m.peer.sessionId, m.peer);
    else if (m.type === "bye") others.delete(m.sessionId);
    else if (m.type === "who") announce();
    emit();
  };
  h.onWelcome(sessionId, [me()]);
  channel.postMessage({ type: "who" } satisfies TabMessage);
  announce();
  const timer = setInterval(() => {
    announce();
    emit();
  }, 20_000);
  window.addEventListener("pagehide", bye);

  return {
    send() {
      announce();
      emit();
    },
    close() {
      clearInterval(timer);
      bye();
      window.removeEventListener("pagehide", bye);
      channel.close();
    },
  };
}
