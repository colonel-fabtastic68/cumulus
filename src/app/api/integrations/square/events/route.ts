import { appUrl, requireServiceAccount, systemContext } from "@/lib/integrations/server";
import { appWebhookKey, verifySquareWebhook } from "@/lib/integrations/square";
import { handleSquareCountWebhook } from "@/lib/ranch/bridge";
import { INSTANCES, hasFeature } from "@/lib/instances";

export const maxDuration = 60;

/**
 * cumulusOS's app-level Square webhook: one subscription in the Square
 * Developer Console (inventory.count.updated, pointed here) covers every
 * seller who signed in with Square. Each event names its merchant; it goes to
 * the ranch instance connected to that merchant through sign-in, and is
 * ignored otherwise. Square signs it with the subscription's key over this
 * URL plus the raw body.
 */
export async function POST(req: Request) {
  const key = appWebhookKey();
  if (!key) return new Response("Not set up", { status: 404 });
  const raw = await req.text();
  const url = process.env.SQUARE_WEBHOOK_URL?.trim() || `${appUrl(req)}/api/integrations/square/events`;
  if (!verifySquareWebhook(raw, req.headers.get("x-square-hmacsha256-signature"), key, url)) return new Response("Bad signature", { status: 401 });
  let payload: { type?: string; merchant_id?: string };
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if (payload.type !== "inventory.count.updated" || !payload.merchant_id) return Response.json({ ok: true, outcome: "ignored" });
  const sa = requireServiceAccount();
  const outcomes: string[] = [];
  for (const instance of INSTANCES) {
    if (!hasFeature(instance, "ranch")) continue;
    try {
      const ctx = systemContext(instance.workspaceId, sa, instance);
      const square = await ctx.store.get("integrations", "square");
      if (!square || square.status === "not_connected" || square.config?.auth !== "oauth" || square.config.merchantId !== payload.merchant_id) continue;
      outcomes.push(`${instance.id}: ${await handleSquareCountWebhook(ctx, payload)}`);
    } catch (e) {
      console.error(`[square events] ${instance.id}`, e);
      // A non-2xx makes Square retry later.
      return new Response(e instanceof Error ? e.message : "Failed", { status: 500 });
    }
  }
  return Response.json({ ok: true, outcome: outcomes.join("; ") || "no connected workspace" });
}
