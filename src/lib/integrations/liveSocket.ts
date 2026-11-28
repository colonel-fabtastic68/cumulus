import type { RawData, WebSocket } from "ws";

/**
 * The conversation on the QuickBooks live-sync WebSocket, kept free of Firebase
 * and Intuit so it can be exercised against a plain `ws` server.
 *
 *   browser → { type: "auth", token, workspaceId }     within LIVE_AUTH_TIMEOUT_MS of connecting
 *   server  → { type: "ready" }
 *   browser → { type: "sync" }
 *   server  → { type: "progress", step, message }      as each step starts
 *   server  → { type: "done", result }                 then the server closes (1000)
 *   server  → { type: "error", status, message }       at any point, then the server closes
 *
 * The ID token travels as the first message, never in the address, so it does
 * not end up in logs or browser history. Nothing is done for a socket until it
 * has authenticated, one sync runs per connection, and anything off-script
 * closes it.
 */

export const LIVE_AUTH_TIMEOUT_MS = 10_000;
/** The largest message accepted: an auth message is an ID token plus a workspace id. */
export const LIVE_MAX_PAYLOAD = 16 * 1024;

/** Close codes in the application range (4000–4999). */
export const LIVE_CLOSE = { badMessage: 4400, unauthorized: 4401, failed: 4500 } as const;

export interface LiveProgress {
  step: string;
  message: string;
}

export type LiveServerMessage = { type: "ready" } | ({ type: "progress" } & LiveProgress) | { type: "done"; result: unknown } | { type: "error"; status: number; message: string };

export interface LiveSession {
  sync(onProgress: (p: LiveProgress) => void): Promise<unknown>;
}

export interface LiveDeps {
  /** Checks the ID token and workspace membership; throws to refuse. */
  authenticate(token: string, workspaceId: string): Promise<LiveSession>;
  /** Turns a thrown error into what the browser is told. */
  describeError(e: unknown): { status: number; message: string };
  authTimeoutMs?: number;
}

type Stage = "awaiting-auth" | "authenticating" | "ready" | "syncing" | "closed";

export function serveLiveSync(ws: WebSocket, deps: LiveDeps): void {
  let stage: Stage = "awaiting-auth";
  let session: LiveSession | null = null;

  const send = (message: LiveServerMessage) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };
  const end = (code: number, reason: string) => {
    if (stage === "closed") return;
    stage = "closed";
    clearTimeout(authTimer);
    ws.close(code, reason);
  };
  const refuse = (code: number, status: number, message: string) => {
    send({ type: "error", status, message });
    end(code, message.slice(0, 100));
  };

  const authTimer = setTimeout(() => {
    if (stage === "awaiting-auth") refuse(LIVE_CLOSE.unauthorized, 401, "Sign in first.");
  }, deps.authTimeoutMs ?? LIVE_AUTH_TIMEOUT_MS);

  ws.on("close", () => {
    stage = "closed";
    clearTimeout(authTimer);
  });
  ws.on("error", () => end(1011, "Connection error"));

  ws.on("message", (data: RawData, isBinary: boolean) => {
    if (stage === "closed") return;
    if (isBinary) return refuse(LIVE_CLOSE.badMessage, 400, "Only text messages are accepted.");
    let message: { type?: unknown; token?: unknown; workspaceId?: unknown };
    try {
      const parsed: unknown = JSON.parse(data.toString());
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      message = parsed;
    } catch {
      return refuse(LIVE_CLOSE.badMessage, 400, "That message could not be read.");
    }

    if (message.type === "auth" && stage === "awaiting-auth") {
      const token = typeof message.token === "string" ? message.token : "";
      const workspaceId = typeof message.workspaceId === "string" ? message.workspaceId : "";
      stage = "authenticating";
      clearTimeout(authTimer);
      deps.authenticate(token, workspaceId).then(
        (s) => {
          if (stage !== "authenticating") return;
          session = s;
          stage = "ready";
          send({ type: "ready" });
        },
        (e) => {
          if (stage !== "authenticating") return;
          const { status, message: text } = deps.describeError(e);
          refuse(status === 401 || status === 403 ? LIVE_CLOSE.unauthorized : LIVE_CLOSE.failed, status, text);
        },
      );
      return;
    }

    if (message.type === "sync" && stage === "ready" && session) {
      stage = "syncing";
      session.sync((p) => stage === "syncing" && send({ type: "progress", step: p.step, message: p.message })).then(
        (result) => {
          if (stage !== "syncing") return;
          send({ type: "done", result });
          end(1000, "Done");
        },
        (e) => {
          if (stage !== "syncing") return;
          const { status, message: text } = deps.describeError(e);
          refuse(LIVE_CLOSE.failed, status, text);
        },
      );
      return;
    }

    refuse(LIVE_CLOSE.badMessage, 400, "That message was not expected here.");
  });
}
