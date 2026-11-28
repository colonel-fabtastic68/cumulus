import { upgradeWebSocket } from "@vercel/functions";
import { serverFeatureEnabled } from "@/lib/features";
import { assertIntegrationAllowed } from "@/lib/integrations/connect";
import { LIVE_MAX_PAYLOAD, serveLiveSync } from "@/lib/integrations/liveSocket";
import { syncQuickbooksNow } from "@/lib/integrations/quickbooksSync";
import { HttpError, authenticateWith, requestHost, requestInstance } from "@/lib/integrations/server";
import { isRanch } from "@/lib/ranch/bridge";

export const maxDuration = 120;

/**
 * The live QuickBooks sync channel (wss). The browser opens it from the
 * QuickBooks connection, proves who it is with its first message, asks for a
 * sync, and is told each step as it happens. The conversation is in
 * src/lib/integrations/liveSocket.ts.
 *
 * The same rules as the HTTP sync route apply: a valid ID token (with its
 * sign-in code entered), membership of the workspace with write access, and a
 * connected QuickBooks company. Where the server cannot upgrade a connection
 * (`next dev`, or a host other than Vercel) this answers 501 and the browser
 * falls back to POST /api/integrations/quickbooks/sync.
 */
export async function GET(req: Request) {
  if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return Response.json({ error: "This address only accepts WebSocket connections." }, { status: 426, headers: { Upgrade: "websocket" } });
  }
  // Browsers always name the page that opened a socket; only this site's own pages may.
  const origin = req.headers.get("origin");
  if (origin && !sameHost(origin, requestHost(req))) return Response.json({ error: "This connection is not allowed from another site." }, { status: 403 });
  const instance = requestInstance(req);

  try {
    return await upgradeWebSocket(
      (ws) =>
        serveLiveSync(ws, {
          authenticate: async (token, workspaceId) => {
            const ctx = await authenticateWith({ token, workspaceId, instance }, { write: true });
            assertIntegrationAllowed(ctx, "quickbooks");
            if (isRanch(ctx)) throw new HttpError(404, "This connection is not available here.");
            const settings = await ctx.store.get("settings", "default");
            if (!serverFeatureEnabled("quickbooksLiveSync", settings?.features)) throw new HttpError(404, "Live QuickBooks sync is not switched on for this workspace.");
            return { sync: (onProgress) => syncQuickbooksNow(ctx, onProgress) };
          },
          describeError: (e) => {
            const status = e instanceof HttpError ? e.status : 500;
            if (status >= 500) console.error("[quickbooks-live]", e);
            return { status, message: e instanceof HttpError ? e.message : "The sync could not be finished. Try again in a minute." };
          },
        }),
      { maxPayload: LIVE_MAX_PAYLOAD },
    );
  } catch (e) {
    console.error("[quickbooks-live] upgrade failed", e instanceof Error ? e.message : e);
    return Response.json({ error: "Live sync is not available on this server." }, { status: 501 });
  }
}

function sameHost(origin: string, host: string): boolean {
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}
