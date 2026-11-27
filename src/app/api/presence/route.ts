import { upgradeWebSocket } from "@vercel/functions";
import { requestInstance } from "@/lib/integrations/server";
import { serverFeatureEnabled } from "@/lib/features";
import { readServiceAccount } from "@/lib/mcp/adminStore";
import { presenceHubFor } from "@/lib/server/presenceFirestore";

/** A connection lasts until the function's limit, then the browser reconnects (src/components/presence/PresenceProvider.tsx). */
export const maxDuration = 300;

/**
 * Live presence over a WebSocket (src/lib/server/presence.ts). The first
 * message carries the ID token and workspace; nothing is said before it.
 * Needs a Vercel runtime that can upgrade the connection (Vercel itself, or
 * `vc dev`); under `next dev` this answers 501 and the browser falls back to
 * the presence heartbeat it always had.
 */
export async function GET(req: Request) {
  if (!serverFeatureEnabled("livePresence", { livePresence: true })) return text(404, "Live presence is not switched on here.");
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return text(426, "Connect with a WebSocket.");
  const sa = readServiceAccount();
  if (!sa) return text(503, "Live presence needs the Firebase service account on the server.");
  const hub = presenceHubFor(sa, requestInstance(req));
  try {
    return await upgradeWebSocket((ws) => hub.attach(ws), { maxPayload: 16 * 1024 });
  } catch (e) {
    console.warn("[presence] no WebSocket upgrade here:", e instanceof Error ? e.message : e);
    return text(501, "This server cannot hold WebSocket connections.");
  }
}

function text(status: number, body: string) {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
