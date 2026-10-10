import { HttpError, authenticate, jsonError, readJson } from "@/lib/integrations/server";
import { switchRanchMode } from "@/lib/ranch/bridge";

export const maxDuration = 300;

/**
 * Who holds the ranch counts. `{ mode: "cumulus", dryRun: true }` previews
 * what taking over would change in Square; without dryRun it switches.
 * Owners and admins only: it changes what the counter sees.
 */
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req, { write: true, manage: true });
    const body = await readJson<{ mode?: unknown; dryRun?: unknown }>(req);
    if (body.mode !== "cumulus" && body.mode !== "square") throw new HttpError(400, "mode is cumulus or square.");
    return Response.json(await switchRanchMode(ctx, body.mode, { dryRun: body.dryRun === true }));
  } catch (e) {
    return jsonError(e);
  }
}
