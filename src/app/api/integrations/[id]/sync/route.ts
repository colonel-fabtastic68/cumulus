import { isChannel, runChannelSync } from "@/lib/integrations/channelSync";
import { HttpError, authenticate, jsonError, loadConnected, readJson } from "@/lib/integrations/server";
import { nowIso } from "@/lib/utils";

export const maxDuration = 120;

interface SyncBody {
  products?: boolean;
  orders?: boolean;
  pushStock?: boolean;
  pushProducts?: boolean;
  pushDetails?: boolean;
}

/** Runs the whole two-way pass now: deletes out, products and orders in, new items out, edits out, stock out. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isChannel(id)) throw new HttpError(404, "Only sales channels sync.");
    const ctx = await authenticate(req, { write: true });
    const body = await readJson<SyncBody>(req).catch(() => ({}) as SyncBody);
    const { integration, secrets } = await loadConnected(ctx, id);
    try {
      const result = await runChannelSync(ctx, integration, secrets, body);
      return Response.json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await ctx.store.patch("integrations", id, { lastError: message, status: e instanceof HttpError && e.status === 401 ? "error" : "connected", lastSyncAt: nowIso() });
      throw e;
    }
  } catch (e) {
    return jsonError(e);
  }
}
