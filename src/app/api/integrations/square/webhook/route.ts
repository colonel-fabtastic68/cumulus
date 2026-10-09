import { readSecrets, requestInstance, systemContext } from "@/lib/integrations/server";
import { verifySquareWebhook } from "@/lib/integrations/square";
import { handleSquareCountWebhook, isRanch } from "@/lib/ranch/bridge";

export const maxDuration = 60;

/**
 * Square inventory.count.updated for a ranch instance (the only place Square
 * webhooks are registered; src/proxy.ts keeps this route off the shared
 * product). Square signs each delivery with the subscription's key over the
 * exact notification URL plus the raw body; the URL stored at subscribe time
 * is used, since proxies can rewrite what this request sees.
 */
export async function POST(req: Request) {
  const instance = requestInstance(req);
  const ws = new URL(req.url).searchParams.get("ws") ?? "";
  if (!instance || ws !== instance.workspaceId) return new Response("Not found", { status: 404 });
  const raw = await req.text();
  let ctx;
  try {
    ctx = systemContext(ws, undefined, instance);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Unavailable", { status: 503 });
  }
  if (!isRanch(ctx)) return new Response("Not found", { status: 404 });
  const secrets = await readSecrets(ctx, "square");
  if (!secrets?.webhookSignatureKey || !secrets.webhookUrl) return new Response("Not subscribed", { status: 410 });
  if (!verifySquareWebhook(raw, req.headers.get("x-square-hmacsha256-signature"), secrets.webhookSignatureKey, secrets.webhookUrl)) return new Response("Bad signature", { status: 401 });
  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  if ((payload as { type?: string }).type !== "inventory.count.updated") return Response.json({ ok: true, outcome: "ignored" });
  try {
    const outcome = await handleSquareCountWebhook(ctx, payload);
    return Response.json({ ok: true, outcome });
  } catch (e) {
    console.error("[square webhook]", e);
    // A non-2xx makes Square retry later, which is what an outage on either side needs.
    return new Response(e instanceof Error ? e.message : "Failed", { status: 500 });
  }
}
