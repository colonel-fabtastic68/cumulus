import { handleChannelWebhook, isChannel } from "@/lib/integrations/channelSync";
import { readSecrets, safeEqual, systemContext } from "@/lib/integrations/server";
import { verifyShopifyWebhook } from "@/lib/integrations/shopify";
import { verifyWooWebhook } from "@/lib/integrations/woocommerce";

export const maxDuration = 60;

/**
 * Receives Shopify and WooCommerce webhooks. The URL carries a per-workspace
 * token; on top of that Shopify deliveries are checked against the app's API
 * secret when one was given, and WooCommerce deliveries against the webhook secret.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isChannel(id)) return new Response("Unknown channel", { status: 404 });
  const url = new URL(req.url);
  const ws = url.searchParams.get("ws") ?? "";
  const token = url.searchParams.get("t") ?? "";
  if (!ws || !token || !/^[A-Za-z0-9_-]{1,128}$/.test(ws)) return new Response("Unauthorized", { status: 401 });
  const raw = await req.text();
  let ctx;
  try {
    ctx = systemContext(ws);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Unavailable", { status: 503 });
  }
  const secrets = await readSecrets(ctx, id);
  if (!secrets?.webhookToken || !safeEqual(secrets.webhookToken, token)) return new Response("Unauthorized", { status: 401 });
  const integration = await ctx.store.get("integrations", id);
  if (!integration || integration.status === "not_connected") return new Response("Not connected", { status: 410 });

  let topic: string;
  if (id === "shopify") {
    if (secrets.apiSecret && !verifyShopifyWebhook(raw, req.headers.get("x-shopify-hmac-sha256"), secrets.apiSecret)) return new Response("Bad signature", { status: 401 });
    topic = req.headers.get("x-shopify-topic") ?? "";
  } else {
    // WooCommerce pings a new webhook with "webhook_id=…" before the first real delivery.
    if (raw.startsWith("webhook_id=")) return Response.json({ ok: true, outcome: "ping" });
    if (!verifyWooWebhook(raw, req.headers.get("x-wc-webhook-signature"), secrets.webhookToken)) return new Response("Bad signature", { status: 401 });
    topic = req.headers.get("x-wc-webhook-topic") ?? "";
  }

  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  try {
    const outcome = await handleChannelWebhook(ctx, integration, secrets, topic, payload);
    return Response.json({ ok: true, outcome });
  } catch (e) {
    console.error(`[webhook ${id}]`, e);
    return new Response(e instanceof Error ? e.message : "Failed", { status: 500 });
  }
}
