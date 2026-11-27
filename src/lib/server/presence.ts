import { randomBytes } from "node:crypto";
import type { RawData, WebSocket } from "ws";
import { CLOSE, PRESENCE_HELLO_TIMEOUT_MS, PRESENCE_REFRESH_MS, PRESENCE_STALE_MS, freshPeers, parseClientMessage, type PresencePeer, type ServerMessage } from "@/lib/presence";

/**
 * The live presence hub behind /api/presence (protocol in src/lib/presence.ts).
 *
 * Vercel pins each WebSocket to one function instance, and two people in the
 * same workspace can land on different instances. So every session is also
 * written to a shared store (the backbone: Firestore in production, a Map in
 * the checks), each instance listens to the workspaces it has sockets for,
 * and the peers a browser sees are this instance's sessions plus the others'.
 *
 * The hub takes its sign-in check and its store as arguments, so it can be
 * exercised without Firebase.
 */

export class PresenceRefusal extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
  }
}

/** Checks the hello message's ID token and workspace; throws PresenceRefusal to close the socket with a reason. */
export type PresenceAuthenticator = (token: string, workspaceId: string) => Promise<{ memberId: string; workspaceId: string }>;

/** A session as the shared store keeps it: which instance holds its socket, so that instance's own copy wins. */
export interface StoredPeer extends PresencePeer {
  instanceId: string;
}

export interface PresenceBackbone {
  put(workspaceId: string, peer: StoredPeer): Promise<void>;
  remove(workspaceId: string, sessionId: string): Promise<void>;
  /** Calls back with every stored session of the workspace whenever one changes. Returns the unsubscribe. */
  watch(workspaceId: string, onChange: (peers: StoredPeer[]) => void): () => void;
}

interface LocalSession {
  ws: WebSocket;
  peer: PresencePeer;
  /** Answered the last ping; a socket that misses one is cut. */
  alive: boolean;
}

interface Room {
  id: string;
  local: Map<string, LocalSession>;
  remote: StoredPeer[];
  unwatch: () => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const OPEN = 1;
/** Peers lists go out at most this often per workspace. */
const BROADCAST_DEBOUNCE_MS = 120;

export interface PresenceHubOptions {
  authenticate: PresenceAuthenticator;
  backbone: PresenceBackbone;
  instanceId?: string;
  now?: () => number;
  newId?: () => string;
  refreshMs?: number;
}

export class PresenceHub {
  readonly instanceId: string;
  private rooms = new Map<string, Room>();
  private ticker: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private opts: PresenceHubOptions) {
    this.instanceId = opts.instanceId ?? randomBytes(6).toString("hex");
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? (() => randomBytes(9).toString("base64url"));
  }

  /** Sessions connected to this instance, for logs and checks. */
  get size(): number {
    let n = 0;
    for (const r of this.rooms.values()) n += r.local.size;
    return n;
  }

  /** Takes over a freshly upgraded socket: waits for hello, then keeps the session in its workspace's room until it closes. */
  attach(ws: WebSocket): void {
    let session: { room: Room; id: string } | null = null;
    let authing = false;
    let closed = false;
    const helloTimer = setTimeout(() => {
      if (!session) ws.close(CLOSE.signIn, "Sign in first.");
    }, PRESENCE_HELLO_TIMEOUT_MS);

    ws.on("message", (data: RawData, isBinary: boolean) => {
      if (isBinary) return ws.close(CLOSE.badMessage, "Text messages only.");
      const msg = parseClientMessage(rawText(data));
      if (!msg) return ws.close(CLOSE.badMessage, "That message was not understood.");
      if (msg.type === "ping") return send(ws, { type: "pong" });

      if (!session) {
        if (msg.type !== "hello" || authing) return ws.close(CLOSE.badMessage, "Say hello first.");
        authing = true;
        this.opts.authenticate(msg.token, msg.workspaceId).then(
          (who) => {
            if (closed || ws.readyState !== OPEN) return;
            clearTimeout(helloTimer);
            const room = this.room(who.workspaceId);
            const now = this.now();
            const id = this.newId();
            const peer: PresencePeer = { sessionId: id, memberId: who.memberId, path: msg.view.path, editing: msg.view.editing, since: now, seenAt: now };
            room.local.set(id, { ws, peer, alive: true });
            session = { room, id };
            send(ws, { type: "welcome", sessionId: id, peers: this.peersOf(room) });
            this.store(room, peer);
            this.schedule(room);
          },
          (e: unknown) => {
            const code = e instanceof PresenceRefusal ? e.code : CLOSE.notSetUp;
            if (!(e instanceof PresenceRefusal)) console.error("[presence] sign-in check failed", e);
            ws.close(code, reason(e instanceof Error ? e.message : "Refused."));
          },
        );
        return;
      }

      if (msg.type === "view") {
        const local = session.room.local.get(session.id);
        if (!local) return;
        local.peer = { ...local.peer, path: msg.view.path, editing: msg.view.editing, seenAt: this.now() };
        this.store(session.room, local.peer);
        this.schedule(session.room);
      }
    });

    ws.on("pong", () => {
      const local = session?.room.local.get(session.id);
      if (local) local.alive = true;
    });

    ws.on("close", () => {
      closed = true;
      clearTimeout(helloTimer);
      if (session) this.leave(session.room, session.id);
      session = null;
    });

    ws.on("error", () => {
      // A close event follows.
    });
  }

  private room(id: string): Room {
    const existing = this.rooms.get(id);
    if (existing) return existing;
    const room: Room = { id, local: new Map(), remote: [], unwatch: () => {}, timer: null };
    this.rooms.set(id, room);
    room.unwatch = this.opts.backbone.watch(id, (peers) => {
      room.remote = peers.filter((p) => p.instanceId !== this.instanceId);
      this.schedule(room);
    });
    this.startTicker();
    return room;
  }

  private leave(room: Room, id: string) {
    room.local.delete(id);
    this.opts.backbone.remove(room.id, id).catch((e) => console.error("[presence] remove failed", e));
    if (room.local.size === 0) {
      room.unwatch();
      if (room.timer) clearTimeout(room.timer);
      this.rooms.delete(room.id);
      if (this.rooms.size === 0) this.stopTicker();
      return;
    }
    this.schedule(room);
  }

  private store(room: Room, peer: PresencePeer) {
    this.opts.backbone.put(room.id, { ...peer, instanceId: this.instanceId }).catch((e) => console.error("[presence] write failed", e));
  }

  private peersOf(room: Room): PresencePeer[] {
    const local = [...room.local.values()].map((s) => s.peer);
    const remote = room.remote.map((p): PresencePeer => ({ sessionId: p.sessionId, memberId: p.memberId, path: p.path, editing: p.editing, since: p.since, seenAt: p.seenAt }));
    return freshPeers([...local, ...remote], this.now());
  }

  private schedule(room: Room) {
    if (room.timer) return;
    room.timer = setTimeout(() => {
      room.timer = null;
      const msg: ServerMessage = { type: "peers", peers: this.peersOf(room) };
      for (const s of room.local.values()) send(s.ws, msg);
    }, BROADCAST_DEBOUNCE_MS);
  }

  /** Once a minute: cut sockets that stopped answering, check the rest in, and clear sessions other instances left behind. */
  tick() {
    const now = this.now();
    for (const room of this.rooms.values()) {
      for (const s of room.local.values()) {
        if (!s.alive) {
          s.ws.terminate();
          continue;
        }
        s.alive = false;
        s.ws.ping();
        s.peer = { ...s.peer, seenAt: now };
        this.store(room, s.peer);
      }
      for (const p of room.remote) {
        if (now - p.seenAt > PRESENCE_STALE_MS) this.opts.backbone.remove(room.id, p.sessionId).catch(() => {});
      }
      this.schedule(room);
    }
  }

  private startTicker() {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.tick(), this.opts.refreshMs ?? PRESENCE_REFRESH_MS);
    this.ticker.unref?.();
  }

  private stopTicker() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
  }
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === OPEN) ws.send(JSON.stringify(msg));
}

function rawText(data: RawData): string {
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data as ArrayBuffer).toString("utf8");
}

/** Close reasons are limited to 123 bytes. */
function reason(text: string): string {
  return Buffer.byteLength(text) <= 120 ? text : `${text.slice(0, 100)}…`;
}

/** A backbone kept in memory: one instance, nothing shared. For checks, and for a server with no database. */
export function memoryBackbone(): PresenceBackbone & { peers: Map<string, Map<string, StoredPeer>> } {
  const peers = new Map<string, Map<string, StoredPeer>>();
  const watchers = new Map<string, Set<(peers: StoredPeer[]) => void>>();
  const notify = (ws: string) => {
    const list = [...(peers.get(ws)?.values() ?? [])];
    for (const cb of watchers.get(ws) ?? []) cb(list);
  };
  return {
    peers,
    async put(ws, peer) {
      if (!peers.has(ws)) peers.set(ws, new Map());
      peers.get(ws)!.set(peer.sessionId, peer);
      notify(ws);
    },
    async remove(ws, id) {
      peers.get(ws)?.delete(id);
      notify(ws);
    },
    watch(ws, cb) {
      if (!watchers.has(ws)) watchers.set(ws, new Set());
      watchers.get(ws)!.add(cb);
      cb([...(peers.get(ws)?.values() ?? [])]);
      return () => watchers.get(ws)?.delete(cb);
    },
  };
}
