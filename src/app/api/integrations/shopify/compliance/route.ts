import { handleShopifyCompliance } from "@/lib/integrations/shopifyCompliance";
import { HttpError } from "@/lib/integrations/server";
import { shopifyAppConfig } from "@/lib/integrations/shopifyOAuth";
import { isShopifyComplianceTopic, parseComplianceRequest, verifyShopifyWebhookHmac } from "@/lib/server/shopifyComplianceRules";

export const maxDuration = 60;

/**
 * Shopify's mandatory privacy webhooks (customers/data_request,
 * customers/redact, shop/redact), one URL for the whole app. Every delivery
 * must carry a valid HMAC made with the app's client secret; anything else is
 * answered 401, as Shopify's app review requires.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = shopifyAppConfig()?.clientSecret ?? "";
  if (!verifyShopifyWebhookHmac(raw, req.headers.get("x-shopify-hmac-sha256"), secret)) return new Response("Unauthorized", { status: 401 });

  const topic = req.headers.get("x-shopify-topic") ?? "";
  if (!isShopifyComplianceTopic(topic)) return Response.json({ ok: true, ignored: true, topic });
  let payload: unknown;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  let request;
  try {
    request = parseComplianceRequest(topic, payload);
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Bad payload", { status: 400 });
  }
  const shopHeader = req.headers.get("x-shopify-shop-domain")?.trim().toLowerCase();
  if (shopHeader && shopHeader !== request.shop) return new Response("Shop mismatch", { status: 400 });

  try {
    const outcome = await handleShopifyCompliance(request);
    console.info(`[shopify compliance] ${topic} for ${request.shop}: ${outcome.workspaces} workspaces, ${outcome.orders} orders, ${outcome.customers} customers`);
    return Response.json({ ok: true, topic, ...outcome });
  } catch (e) {
    console.error(`[shopify compliance] ${topic}`, e);
    if (e instanceof HttpError) return new Response(e.message, { status: e.status });
    return new Response(e instanceof Error ? e.message : "Failed", { status: 500 });
  }
}
