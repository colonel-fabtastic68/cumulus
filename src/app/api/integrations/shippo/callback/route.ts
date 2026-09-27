import { getFirestore } from "firebase-admin/firestore";
import { connectIntegration } from "@/lib/integrations/connect";
import { consumeShippoState, exchangeShippoCode, requireShippoOAuthConfig } from "@/lib/integrations/shippoOAuth";
import { HttpError, appUrl, requireServiceAccount, systemContext } from "@/lib/integrations/server";
import { adminApp } from "@/lib/mcp/adminStore";

export const maxDuration = 60;

/**
 * Where Shippo sends the browser after the merchant approves. The state ties
 * the callback to a workspace and the manager who started it; the code
 * becomes the merchant's bearer token, and the usual carrier connect path
 * verifies it and registers the tracking webhook.
 */
export async function GET(req: Request) {
  const base = appUrl(req);
  const params = new URL(req.url).searchParams;
  const back = (query: Record<string, string>) => Response.redirect(`${base}/integrations?${new URLSearchParams(query).toString()}`, 302);
  try {
    const sa = requireServiceAccount();
    const config = requireShippoOAuthConfig();
    const db = getFirestore(adminApp(sa));
    const state = params.get("state") ?? "";
    if (!state) throw new HttpError(400, "The Shippo sign-in did not come from this app (missing state).");
    const issued = await consumeShippoState(db, state);
    const denied = params.get("error");
    if (denied) throw new HttpError(400, denied === "access_denied" ? "Shippo access was not granted." : `Shippo reported: ${params.get("error_description") ?? denied}`);
    const code = params.get("code") ?? "";
    if (!code) throw new HttpError(400, "Shippo did not send back an authorization code.");

    const ctx = systemContext(issued.workspaceId, sa);
    const member = await db.doc(`workspaces/${issued.workspaceId}/members/${issued.uid}`).get();
    if (!member.exists) throw new HttpError(403, "The account that started the connection is no longer a member of the workspace.");
    ctx.actor = { id: issued.uid, name: (member.data() as { name?: string }).name ?? "Member" };

    const token = await exchangeShippoCode(config, code);
    await connectIntegration(ctx, req, "shippo", { credentials: { token } });
    return back({ connected: "shippo" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!(e instanceof HttpError) || e.status >= 500) console.error("[shippo callback]", e);
    return back({ error: `Shippo: ${message}` });
  }
}
