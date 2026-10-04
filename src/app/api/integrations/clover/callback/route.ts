import { getFirestore } from "firebase-admin/firestore";
import type { Integration } from "@/lib/types";
import { activityOp } from "@/lib/inventory";
import { connectionConfig, consumeCloverState, exchangeCloverCode, isMerchantId, merchantSummary, requireCloverConfig, siteOf } from "@/lib/integrations/clover";
import { HttpError, appUrl, requireServiceAccount, systemContext, writeSecrets } from "@/lib/integrations/server";
import { adminApp } from "@/lib/mcp/adminStore";
import { nowIso } from "@/lib/utils";

export const maxDuration = 60;

/**
 * Where Clover sends the browser after the merchant approves, with the code
 * and the merchant id. The state alone ties it to a workspace and the manager
 * who started it; a launch from the Clover App Market carries no state, so it
 * is sent on to the Integrations page to start the connection properly.
 */
export async function GET(req: Request) {
  const base = appUrl(req);
  const params = new URL(req.url).searchParams;
  const back = (query: Record<string, string>) => Response.redirect(`${base}/integrations?${new URLSearchParams(query).toString()}`, 302);
  try {
    const sa = requireServiceAccount();
    const config = requireCloverConfig();
    const db = getFirestore(adminApp(sa));
    const state = params.get("state") ?? "";
    if (!state) throw new HttpError(400, params.get("merchant_id") ? "Start the connection from the Integrations page with Connect to Clover, so it is tied to your workspace." : "The Clover sign-in did not come from this app (missing state).");
    const issued = await consumeCloverState(db, state);
    const denied = params.get("error");
    if (denied) throw new HttpError(400, denied === "access_denied" ? "Clover access was not granted." : `Clover reported: ${params.get("error_description") ?? denied}`);
    const code = params.get("code") ?? "";
    if (!code) throw new HttpError(400, "Clover did not send back an authorization code.");
    const merchantId = params.get("merchant_id") ?? "";
    if (!isMerchantId(merchantId)) throw new HttpError(400, "Clover did not send back the merchant id.");
    const appId = params.get("client_id");
    if (appId && appId !== config.appId) throw new HttpError(400, "The sign-in was for a different Clover app than this server is configured with.");

    const ctx = systemContext(issued.workspaceId, sa);
    const member = await db.doc(`workspaces/${issued.workspaceId}/members/${issued.uid}`).get();
    if (!member.exists) throw new HttpError(403, "The account that started the connection is no longer a member of the workspace.");
    ctx.actor = { id: issued.uid, name: (member.data() as { name?: string }).name ?? "Member" };

    const secrets = await exchangeCloverCode(config, code, merchantId);
    const site = siteOf(secrets, config);
    const { merchant, currency } = await merchantSummary(site, secrets.accessToken);
    await writeSecrets(ctx, "clover", secrets);
    const existing = await ctx.store.get("integrations", "clover");
    const now = nowIso();
    const doc: Integration = {
      id: "clover",
      status: "connected",
      config: connectionConfig(site, merchant, currency, "oauth"),
      settings: existing?.settings ?? { syncProducts: true, takeStockOnFirstSync: false },
      connectedAt: now,
      connectedBy: issued.uid,
      lastSyncAt: existing?.lastSyncAt,
      lastSyncSummary: existing?.lastSyncSummary,
      webhooks: [],
      createdAt: existing?.createdAt ?? now,
    };
    await ctx.store.batch([{ op: "put", collection: "integrations", doc }, activityOp(ctx.actor, "integration.connected", `Connected Clover (${doc.config!.businessName})`, { entityType: "integration", entityId: "clover" })]);
    return back({ connected: "clover" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!(e instanceof HttpError) || e.status >= 500) console.error("[clover callback]", e);
    return back({ error: `Clover: ${message}` });
  }
}
