import { isChannel, pushStockToChannel } from "@/lib/integrations/channelSync";
import { authenticate, jsonError, readJson, readSecrets } from "@/lib/integrations/server";

export const maxDuration = 60;

/** Pushes the current on-hand count of the given items to every connected channel that mirrors stock. */
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req, { write: true });
    const body = await readJson<{ itemIds?: string[] }>(req);
    const itemIds = Array.isArray(body.itemIds) ? body.itemIds.filter((x): x is string => typeof x === "string").slice(0, 500) : undefined;
    const integrations = (await ctx.store.list("integrations")).filter((i) => isChannel(i.id) && i.status === "connected" && i.settings?.pushStock);
    const results: Record<string, { pushed: number; skipped: number; errors: string[] }> = {};
    for (const integration of integrations) {
      const secrets = await readSecrets(ctx, integration.id);
      if (!secrets) continue;
      try {
        results[integration.id] = await pushStockToChannel(ctx, integration, secrets, itemIds);
        if (results[integration.id]!.errors.length) await ctx.store.patch("integrations", integration.id, { lastError: `Stock push: ${results[integration.id]!.errors.slice(0, 3).join("; ")}` });
      } catch (e) {
        results[integration.id] = { pushed: 0, skipped: 0, errors: [e instanceof Error ? e.message : String(e)] };
      }
    }
    return Response.json({ results });
  } catch (e) {
    return jsonError(e);
  }
}
