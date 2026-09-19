import { beginShopifyAuthorization, requireShopifyAppConfig } from "@/lib/integrations/shopifyOAuth";
import { HttpError, appUrl, authenticate, jsonError, readJson } from "@/lib/integrations/server";

export const maxDuration = 30;

/** Starts the Shopify authorization code grant for the given store: stores a single-use state and returns the consent URL. */
export async function POST(req: Request) {
  try {
    const config = requireShopifyAppConfig();
    const ctx = await authenticate(req, { manage: true });
    const { shop } = await readJson<{ shop?: unknown }>(req);
    if (typeof shop !== "string" || !shop.trim()) throw new HttpError(400, "Enter the store's .myshopify.com address.");
    const { url, shop: normalized } = await beginShopifyAuthorization(ctx, shop, appUrl(req), config);
    return Response.json({ url, shop: normalized });
  } catch (e) {
    return jsonError(e);
  }
}
