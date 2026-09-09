import { isChannel, pushStockToChannel, syncChannel } from "@/lib/integrations/channelSync";
import { HttpError, authenticate, jsonError, loadConnected, readJson } from "@/lib/integrations/server";
import { nowIso } from "@/lib/utils";

export const maxDuration = 120;

interface SyncBody {
  products?: boolean;
  orders?: boolean;
  /** Also push every linked item's on-hand count to the channel. */
  pushStock?: boolean;
}

/** Runs a sync now: products in, open orders in and, when asked, stock out. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isChannel(id)) throw new HttpError(404, "Only sales channels sync.");
    const ctx = await authenticate(req, { write: true });
    const body = await readJson<SyncBody>(req).catch(() => ({}) as SyncBody);
    const { integration, secrets } = await loadConnected(ctx, id);
    const what = { products: body.products ?? integration.settings?.syncProducts !== false, orders: body.orders ?? integration.settings?.syncOrders !== false };
    try {
      const result = await syncChannel(ctx, integration, secrets, what);
      let push: Awaited<ReturnType<typeof pushStockToChannel>> | undefined;
      if (body.pushStock ?? integration.settings?.pushStock) {
        push = await pushStockToChannel(ctx, integration, secrets);
        if (push.errors.length) await ctx.store.patch("integrations", id, { lastError: `Stock push: ${push.errors.slice(0, 3).join("; ")}` });
      }
      return Response.json({ ...result, push });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await ctx.store.patch("integrations", id, { lastError: message, status: e instanceof HttpError && e.status === 401 ? "error" : "connected", lastSyncAt: nowIso() });
      throw e;
    }
  } catch (e) {
    return jsonError(e);
  }
}
