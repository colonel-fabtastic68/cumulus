import type { LiveServerMessage } from "./liveSocket";

/** The live channel could not be used before any sync started; the caller should use the ordinary sync request instead. */
export class LiveSyncUnavailable extends Error {}

const CONNECT_TIMEOUT_MS = 8000;

/**
 * Runs a QuickBooks sync over the live WebSocket (see liveSocket.ts for the
 * conversation) and reports each step. Rejects with LiveSyncUnavailable when
 * the channel never got as far as starting the sync, so nothing runs twice.
 */
export function quickbooksLiveSync<T>(opts: { getToken: () => Promise<string>; workspaceId: string; onProgress: (message: string) => void }): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let started = false;
    let settled = false;
    let socket: WebSocket;
    try {
      socket = new WebSocket(`${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/api/integrations/quickbooks/live`);
    } catch {
      reject(new LiveSyncUnavailable("The live channel could not be opened."));
      return;
    }
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    };
    const timer = setTimeout(() => {
      if (!started) settle(() => reject(new LiveSyncUnavailable("The live channel did not answer in time.")));
    }, CONNECT_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      opts.getToken().then(
        (token) => {
          if (!settled) socket.send(JSON.stringify({ type: "auth", token, workspaceId: opts.workspaceId }));
        },
        () => settle(() => reject(new LiveSyncUnavailable("Sign in first."))),
      );
    });

    socket.addEventListener("message", (event) => {
      let message: LiveServerMessage;
      try {
        message = JSON.parse(String(event.data)) as LiveServerMessage;
      } catch {
        return;
      }
      if (message.type === "ready" && !started) {
        started = true;
        clearTimeout(timer);
        socket.send(JSON.stringify({ type: "sync" }));
      } else if (message.type === "progress") {
        opts.onProgress(message.message);
      } else if (message.type === "done") {
        settle(() => resolve(message.result as T));
      } else if (message.type === "error") {
        // Before the sync starts, the ordinary request reports the same refusal in its own words.
        settle(() => reject(started ? new Error(message.message) : new LiveSyncUnavailable(message.message)));
      }
    });

    socket.addEventListener("close", () => {
      settle(() => reject(started ? new Error("The live connection closed before the sync finished. It may still be finishing: check the last sync time in a minute before syncing again.") : new LiveSyncUnavailable("The live channel closed.")));
    });
  });
}
