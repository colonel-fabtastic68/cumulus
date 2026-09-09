import type { Address } from "@/lib/types";
import { CARRIERS, isCarrier } from "@/lib/integrations/carriers";
import { HttpError, authenticate, jsonError, loadConnected, readJson } from "@/lib/integrations/server";
import { defaultLocation, isOrderOpen, openQty, qtyAt, shipOrder } from "@/lib/inventory";
import { nowIso } from "@/lib/utils";

export const maxDuration = 60;

interface BuyBody {
  orderId: string;
  provider: string;
  rateId: string;
  lines: Array<{ itemId: string; qty: number }>;
  locationId?: string;
  shipTo?: Address;
}

/** Buys the chosen label, then ships the order lines through the ledger with the carrier details attached. */
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req, { write: true });
    const body = await readJson<BuyBody>(req);
    if (!isCarrier(body.provider)) throw new HttpError(400, "Unknown carrier provider.");
    if (!body.rateId || !body.orderId) throw new HttpError(400, "Pick a rate first.");
    const lines = (body.lines ?? []).filter((l) => l && typeof l.itemId === "string" && Number.isFinite(l.qty) && l.qty > 0);
    if (lines.length === 0) throw new HttpError(400, "Choose what to ship.");

    const order = await ctx.store.get("orders", body.orderId);
    if (!order || !isOrderOpen(order)) throw new HttpError(409, "The order is not open.");
    // Check stock before money changes hands: a label for lines that cannot ship helps nobody.
    const items = await ctx.store.list("items");
    const locations = await ctx.store.list("locations");
    const homeId = defaultLocation(locations).location.id;
    const locationId = body.locationId ?? homeId;
    for (const l of lines) {
      const item = items.find((i) => i.id === l.itemId);
      const line = order.lines.find((x) => x.itemId === l.itemId);
      if (!item || !line) throw new HttpError(400, "A line does not belong to this order.");
      if (l.qty > openQty(line)) throw new HttpError(409, `${item.sku}: only ${openQty(line)} is open.`);
      if (item.type !== "assembly" && qtyAt(item, locationId, homeId) < l.qty) throw new HttpError(409, `${item.sku}: not enough stock at the ship-from location.`);
    }

    const { secrets } = await loadConnected(ctx, body.provider);
    if (!secrets.token) throw new HttpError(409, "The carrier has no stored token; connect it again.");
    const label = await CARRIERS[body.provider].buy(secrets.token, body.rateId);

    if (body.shipTo?.street1) await ctx.store.patch("orders", order.id, { shipTo: { ...body.shipTo, country: body.shipTo.country.toUpperCase() } });
    try {
      const { shipment } = await shipOrder(ctx.store, ctx.actor, {
        orderId: order.id,
        lines,
        locationId,
        carrier: label.carrier,
        service: label.service,
        trackingNumber: label.trackingNumber,
        trackingUrl: label.trackingUrl,
        labelUrl: label.labelUrl,
        cost: label.cost,
        currency: label.currency,
        provider: body.provider,
        providerRef: label.providerRef,
      });
      await ctx.store.patch("shipments", shipment.id, { trackingStatus: "pre_transit", trackingUpdatedAt: nowIso() });
      return Response.json({ shipment: { ...shipment, trackingStatus: "pre_transit" } });
    } catch (e) {
      // The label exists even though the ledger write failed; say so plainly rather than losing it.
      const message = e instanceof Error ? e.message : String(e);
      throw new HttpError(409, `Label bought (${label.carrier} ${label.trackingNumber}${label.labelUrl ? `, ${label.labelUrl}` : ""}) but the order could not ship: ${message}. Ship it by hand with that tracking number.`);
    }
  } catch (e) {
    return jsonError(e);
  }
}
