import { authenticate, jsonError } from "@/lib/integrations/server";
import { ranchSync, requireRanch } from "@/lib/ranch/bridge";

export const maxDuration = 300;

/** Sync now: Square counts in, outstanding Square pushes retried, missed web orders recorded, packs out. */
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req, { write: true });
    requireRanch(ctx);
    return Response.json(await ranchSync(ctx));
  } catch (e) {
    return jsonError(e);
  }
}
