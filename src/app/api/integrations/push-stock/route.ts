import { isChannel, runChannelSync } from "@/lib/integrations/channelSync";
import { authenticate, jsonError, readJson, readSecrets } from "@/lib/integrations/server";

export const maxDuration = 60;

/**
 * The outbound half for a few items: store products removed for deleted
 * items, new items created, changed details and counts pushed. Called by the
 * page bridge shortly after a change, and by "Push to store".
 */
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req, { write: true });
    const body = await readJson<{ itemIds?: string[]; detailIds?: string[] }>(req);
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 500) : undefined);
    const itemIds = ids(body.itemIds);
    const detailIds = ids(body.detailIds);
    const integrations = (await ctx.store.list("integrations")).filter((i) => isChannel(i.id) && i.status === "connected");
    const results: Record<string, { pushed: number; created?: number; linked?: number; updated?: number; removed: number; errors: string[] }> = {};
    for (const integration of integrations) {
      const secrets = await readSecrets(ctx, integration.id);
      if (!secrets) continue;
      try {
        const r = await runChannelSync(ctx, integration, secrets, { products: false, orders: false, itemIds, detailIds });
        results[integration.id] = { pushed: r.stockPushed ?? 0, created: r.created, linked: r.linked, updated: r.detailsUpdated, removed: r.removed, errors: r.errors };
      } catch (e) {
        results[integration.id] = { pushed: 0, removed: 0, errors: [e instanceof Error ? e.message : String(e)] };
      }
    }
    return Response.json({ results });
  } catch (e) {
    return jsonError(e);
  }
}
