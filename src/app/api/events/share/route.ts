import { newSlug } from "@/lib/calendar";
import { HttpError, appUrl, authenticate, jsonError, readJson } from "@/lib/integrations/server";
import { nowIso } from "@/lib/utils";

/** Gives a calendar event a public slug: eventShares/{slug} points back at the workspace and event. */
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req, { write: true });
    const { eventId } = await readJson<{ eventId?: unknown }>(req);
    if (typeof eventId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(eventId)) throw new HttpError(400, "Unknown event.");
    const event = await ctx.store.get("events", eventId);
    if (!event) throw new HttpError(404, "That event no longer exists.");
    let slug = event.slug ?? "";
    if (!slug) {
      slug = newSlug();
      await ctx.db.doc(`eventShares/${slug}`).set({ workspaceId: ctx.workspaceId, eventId, createdBy: ctx.actor.id, createdAt: nowIso() });
      await ctx.store.patch("events", eventId, { slug, updatedAt: nowIso() });
    }
    return Response.json({ slug, url: `${appUrl(req)}/e/${slug}` });
  } catch (e) {
    return jsonError(e);
  }
}
