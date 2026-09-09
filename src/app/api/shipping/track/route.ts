import { CARRIERS, isCarrier } from "@/lib/integrations/carriers";
import { HttpError, authenticate, jsonError, loadConnected, readJson } from "@/lib/integrations/server";
import { applyTracking } from "@/lib/integrations/tracking";

export const maxDuration = 30;

/** Asks the carrier for the latest tracking status of one shipment. */
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req);
    const body = await readJson<{ shipmentId: string }>(req);
    const shipment = await ctx.store.get("shipments", body.shipmentId ?? "");
    if (!shipment) throw new HttpError(404, "Shipment not found.");
    if (!shipment.provider || !isCarrier(shipment.provider)) throw new HttpError(409, "This shipment was entered by hand; there is no carrier connection to ask.");
    const { secrets } = await loadConnected(ctx, shipment.provider);
    if (!secrets.token) throw new HttpError(409, "The carrier has no stored token; connect it again.");
    const res = await CARRIERS[shipment.provider].track(secrets.token, shipment);
    if (res.status !== shipment.trackingStatus) await applyTracking(ctx, shipment, res.status);
    return Response.json({ status: res.status, detail: res.detail });
  } catch (e) {
    return jsonError(e);
  }
}
