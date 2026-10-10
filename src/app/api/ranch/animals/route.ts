import { HttpError, authenticate, jsonError, readJson } from "@/lib/integrations/server";
import { receiveAnimal } from "@/lib/ranch/bridge";

export const maxDuration = 120;

/** Receives an animal: `{ label, receivedAt?, cuts: [{ itemId, qty }] }`, pounds per cut. */
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req, { write: true });
    const body = await readJson<{ label?: unknown; receivedAt?: unknown; cuts?: unknown }>(req);
    if (typeof body.label !== "string") throw new HttpError(400, "Give the animal its Lot #.");
    if (!Array.isArray(body.cuts) || body.cuts.length > 200) throw new HttpError(400, "List the cuts and their pounds.");
    const cuts = body.cuts
      .filter((c): c is { itemId: string; qty: unknown } => !!c && typeof c === "object" && typeof (c as { itemId?: unknown }).itemId === "string")
      .map((c) => ({ itemId: c.itemId, qty: Number(c.qty) }))
      .filter((c) => Number.isFinite(c.qty));
    return Response.json(await receiveAnimal(ctx, { label: body.label, receivedAt: typeof body.receivedAt === "string" ? body.receivedAt : undefined, cuts }));
  } catch (e) {
    return jsonError(e);
  }
}
