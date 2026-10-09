import { assignStoreSkus, isChannel, type SkuAssignment } from "@/lib/integrations/channelSync";
import { HttpError, authenticate, jsonError, loadConnected, readJson } from "@/lib/integrations/server";
import { isRanch } from "@/lib/ranch/bridge";

export const maxDuration = 120;

/** Gives store products that have no SKU one: written to the store, then the item is created here and linked. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isChannel(id)) throw new HttpError(404, "Only Shopify and WooCommerce products carry SKUs.");
    const ctx = await authenticate(req, { write: true });
    if (isRanch(ctx) || (ctx.instance && !(ctx.instance.integrations as string[]).includes(id))) throw new HttpError(404, "Not available here.");
    const body = await readJson<{ assignments?: unknown }>(req);
    const raw = Array.isArray(body.assignments) ? (body.assignments as Array<Record<string, unknown>>) : [];
    const assignments: SkuAssignment[] = raw.filter((a) => typeof a?.key === "string" && typeof a?.sku === "string").map((a) => ({ key: String(a.key), sku: String(a.sku) }));
    if (assignments.length === 0) throw new HttpError(400, "Send at least one assignment of { key, sku }.");
    if (assignments.length > 100) throw new HttpError(400, "At most 100 SKUs per request.");
    const { integration, secrets } = await loadConnected(ctx, id);
    return Response.json(await assignStoreSkus(ctx, integration, secrets, assignments));
  } catch (e) {
    return jsonError(e);
  }
}
