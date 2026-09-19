import { getFirestore } from "firebase-admin/firestore";
import { connectIntegration } from "@/lib/integrations/connect";
import { consumeShopifyState, exchangeShopifyCode, requireShopifyAppConfig, verifyShopifyCallbackHmac } from "@/lib/integrations/shopifyOAuth";
import { HttpError, appUrl, requireServiceAccount, systemContext } from "@/lib/integrations/server";
import { adminApp } from "@/lib/mcp/adminStore";

export const maxDuration = 60;

/**
 * Where Shopify sends the browser after the merchant approves. The state ties
 * the callback to a workspace; the hmac proves the query came from Shopify;
 * the code becomes an offline token, and the usual connect path verifies the
 * shop and registers webhooks with it.
 */
export async function GET(req: Request) {
  const base = appUrl(req);
  const params = new URL(req.url).searchParams;
  const back = (query: Record<string, string>) => Response.redirect(`${base}/integrations?${new URLSearchParams(query).toString()}`, 302);
  try {
    const sa = requireServiceAccount();
    const config = requireShopifyAppConfig();
    const db = getFirestore(adminApp(sa));
    if (!verifyShopifyCallbackHmac(params, config.clientSecret)) throw new HttpError(400, "The Shopify callback signature did not match. Start again from the Integrations page.");
    const state = params.get("state") ?? "";
    if (!state) throw new HttpError(400, "The Shopify sign-in did not come from this app (missing state).");
    const issued = await consumeShopifyState(db, state);
    const shop = params.get("shop") ?? "";
    if (shop !== issued.shop) throw new HttpError(400, "The store in the callback does not match the one the sign-in started for.");
    const code = params.get("code") ?? "";
    if (!code) throw new HttpError(400, "Shopify did not send back an authorization code.");

    const ctx = systemContext(issued.workspaceId, sa);
    const member = await db.doc(`workspaces/${issued.workspaceId}/members/${issued.uid}`).get();
    if (!member.exists) throw new HttpError(403, "The account that started the connection is no longer a member of the workspace.");
    ctx.actor = { id: issued.uid, name: (member.data() as { name?: string }).name ?? "Member" };

    const { accessToken } = await exchangeShopifyCode(config, shop, code);
    // The client secret signs webhooks, so it doubles as the apiSecret the webhook route checks against.
    await connectIntegration(ctx, req, "shopify", { credentials: { shop, accessToken, apiSecret: config.clientSecret } });
    return back({ connected: "shopify" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (!(e instanceof HttpError) || e.status >= 500) console.error("[shopify callback]", e);
    return back({ error: `Shopify: ${message}` });
  }
}
