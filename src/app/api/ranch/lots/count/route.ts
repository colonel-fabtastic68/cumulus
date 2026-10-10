import { HttpError, authenticate, jsonError, readJson } from "@/lib/integrations/server";
import { recountLot } from "@/lib/ranch/bridge";

export const maxDuration = 120;

/** Recounts one lot (one animal's share of a cut): `{ lotId, qty, note? }`, in pounds. */
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req, { write: true });
    const body = await readJson<{ lotId?: unknown; qty?: unknown; note?: unknown }>(req);
    if (typeof body.lotId !== "string" || !body.lotId) throw new HttpError(400, "Which lot?");
    return Response.json(await recountLot(ctx, { lotId: body.lotId, qty: Number(body.qty), note: typeof body.note === "string" ? body.note.slice(0, 200) : undefined }));
  } catch (e) {
    return jsonError(e);
  }
}
