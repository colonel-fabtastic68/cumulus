import { authenticate, jsonError, readJson } from "@/lib/integrations/server";
import { pushPacks, ranchMode, requireRanch, syncSquareFromCumulus } from "@/lib/ranch/bridge";

export const maxDuration = 120;

/**
 * Sets Square's counts for the lots named (or all) to what cumulusOS holds,
 * after reading in any counter sales. The app calls it after stock changes
 * made on the regular pages; it is safe to repeat. A no-op while Square holds the counts.
 */
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req, { write: true });
    requireRanch(ctx);
    const body = await readJson<{ lotIds?: unknown }>(req).catch(() => ({}) as { lotIds?: unknown });
    const lotIds = Array.isArray(body.lotIds) ? body.lotIds.filter((x): x is string => typeof x === "string").slice(0, 500) : undefined;
    if (ranchMode(await ctx.store.get("integrations", "square")) !== "cumulus") return Response.json({ summary: "Square holds the counts", counts: 0 });
    const r = await syncSquareFromCumulus(ctx, { lotIds, reason: "changed in cumulusOS" });
    const lots = lotIds ? (await ctx.store.list("lots")).filter((l) => lotIds.includes(l.id)) : [];
    const itemIds = Array.from(new Set([...r.itemIds, ...lots.map((l) => l.itemId)]));
    if (itemIds.length) await pushPacks(ctx, { itemIds }).catch(() => undefined);
    return Response.json(r);
  } catch (e) {
    return jsonError(e);
  }
}
