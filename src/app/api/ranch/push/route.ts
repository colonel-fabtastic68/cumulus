import { authenticate, jsonError, readJson } from "@/lib/integrations/server";
import { pushPacks, requireRanch } from "@/lib/ranch/bridge";

export const maxDuration = 120;

/** Pushes pack stock and web prices to the store: all listings, or the ones named; `force` rewrites unchanged ones too. */
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req, { write: true });
    requireRanch(ctx);
    const body = await readJson<{ listingIds?: unknown; force?: unknown }>(req).catch(() => ({}) as { listingIds?: unknown; force?: unknown });
    const listingIds = Array.isArray(body.listingIds) ? body.listingIds.filter((x): x is string => typeof x === "string").slice(0, 500) : undefined;
    return Response.json(await pushPacks(ctx, { listingIds, force: body.force === true }));
  } catch (e) {
    return jsonError(e);
  }
}
