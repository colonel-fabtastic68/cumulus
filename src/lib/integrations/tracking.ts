import type { Shipment } from "@/lib/types";
import { activityOp } from "@/lib/inventory";
import { nowIso } from "@/lib/utils";
import type { ServerContext } from "./server";

/** Records a new tracking status on a shipment, with an activity line. */
export async function applyTracking(ctx: ServerContext, shipment: Shipment, status: string): Promise<void> {
  const now = nowIso();
  await ctx.store.batch([
    { op: "patch", collection: "shipments", id: shipment.id, patch: { trackingStatus: status, trackingUpdatedAt: now } },
    activityOp(ctx.actor, "shipment.tracked", `${shipment.number} ${status.replace(/_/g, " ")}${shipment.carrier ? ` (${shipment.carrier})` : ""}`, { entityType: "shipment", entityId: shipment.id }),
  ]);
}
