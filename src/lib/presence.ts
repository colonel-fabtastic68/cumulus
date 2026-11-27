/**
 * Live presence (the `livePresence` feature): who has cumulusOS open right now,
 * which screen each person is on, and what they are editing. Shared by the
 * browser and the WebSocket route; no React or Firebase here.
 *
 * One browser tab is one session. Hosted workspaces send sessions over a
 * WebSocket to /api/presence (src/lib/server/presence.ts); local mode passes
 * them between tabs with BroadcastChannel, so two tabs signed in as two sample
 * teammates see each other.
 *
 * Nothing here is stored with the workspace's records: a session lives only as
 * long as its tab is connected.
 */

/** What a tab tells the others about itself. */
export interface PresenceView {
  /** The screen, as a pathname (no query string). */
  path: string;
  /** The record whose edit form is open, as `collection/id` (see recordKey), or null. */
  editing: string | null;
}

export interface PresencePeer extends PresenceView {
  sessionId: string;
  memberId: string;
  /** When the session connected (ms). */
  since: number;
  /** When the session last checked in (ms). */
  seenAt: number;
}

/** A session goes quiet for this long, it counts as gone (a tab that closed without saying so). */
export const PRESENCE_STALE_MS = 150_000;
/** How often a connected session checks in. */
export const PRESENCE_REFRESH_MS = 60_000;
/** A hidden tab disconnects after this long and reconnects when it is looked at again. */
export const PRESENCE_HIDDEN_DISCONNECT_MS = 10 * 60_000;
/** The first message must arrive within this. */
export const PRESENCE_HELLO_TIMEOUT_MS = 10_000;

/** WebSocket close codes the browser acts on. 4001/4003/4011 mean: do not retry. */
export const CLOSE = {
  normal: 1000,
  signIn: 4001,
  notMember: 4003,
  badMessage: 4008,
  notSetUp: 4011,
} as const;

export type ClientMessage = { type: "hello"; token: string; workspaceId: string; view: PresenceView } | { type: "view"; view: PresenceView } | { type: "ping" };

export type ServerMessage = { type: "welcome"; sessionId: string; peers: PresencePeer[] } | { type: "peers"; peers: PresencePeer[] } | { type: "pong" };

const MAX_PATH = 300;
const MAX_KEY = 200;

/** The identifier presence uses for a record being edited. */
export function recordKey(collection: string, id: string): string {
  return `${collection}/${id}`;
}

function cleanView(raw: unknown): PresenceView | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as { path?: unknown; editing?: unknown };
  if (typeof v.path !== "string" || !v.path.startsWith("/") || v.path.length > MAX_PATH) return null;
  const editing = typeof v.editing === "string" && v.editing && v.editing.length <= MAX_KEY ? v.editing : null;
  return { path: v.path.split("?")[0]!.split("#")[0]!, editing };
}

/** Parses and checks a message from a browser; null for anything malformed. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const m = data as Record<string, unknown>;
  if (m.type === "ping") return { type: "ping" };
  if (m.type === "view") {
    const view = cleanView(m.view);
    return view ? { type: "view", view } : null;
  }
  if (m.type === "hello") {
    const view = cleanView(m.view);
    if (!view || typeof m.token !== "string" || !m.token || m.token.length > 8192) return null;
    if (typeof m.workspaceId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(m.workspaceId)) return null;
    return { type: "hello", token: m.token, workspaceId: m.workspaceId, view };
  }
  return null;
}

/** Sessions that have checked in recently, one entry per session id. */
export function freshPeers(peers: Iterable<PresencePeer>, now: number): PresencePeer[] {
  const out = new Map<string, PresencePeer>();
  for (const p of peers) {
    if (now - p.seenAt > PRESENCE_STALE_MS) continue;
    const had = out.get(p.sessionId);
    if (!had || had.seenAt < p.seenAt) out.set(p.sessionId, p);
  }
  return [...out.values()].sort((a, b) => a.since - b.since);
}

export interface PresenceSummary {
  /** Members with at least one session open. */
  online: Set<string>;
  /** Other members on the same screen as `path`, earliest first. */
  here: string[];
  /** Other members editing each record key. */
  editing: Map<string, string[]>;
}

/**
 * What the screen shows: who is online, who else is here, who is editing
 * what. `self` is this tab's session, which is never "someone else", though
 * the same person in another tab is.
 */
export function summarize(peers: PresencePeer[], selfSessionId: string | null, selfMemberId: string | null, path: string): PresenceSummary {
  const online = new Set<string>();
  const here: string[] = [];
  const editing = new Map<string, string[]>();
  for (const p of peers) {
    online.add(p.memberId);
    if (p.sessionId === selfSessionId) continue;
    const other = p.memberId !== selfMemberId;
    if (other && p.path === path && !here.includes(p.memberId)) here.push(p.memberId);
    if (p.editing && other) {
      const list = editing.get(p.editing) ?? [];
      if (!list.includes(p.memberId)) list.push(p.memberId);
      editing.set(p.editing, list);
    }
  }
  return { online, here, editing };
}

/** Reconnect delay after the nth failure in a row: 1s, 2s, 4s … up to 30s, with a little jitter. */
export function reconnectDelay(failures: number, random = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** Math.max(0, failures - 1));
  return Math.round(base * (0.8 + random() * 0.4));
}
