import { disconnectIntegration } from "@/lib/integrations/connect";
import { HttpError, authenticate, isIntegrationId, jsonError } from "@/lib/integrations/server";

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isIntegrationId(id)) throw new HttpError(404, "Unknown integration.");
    const ctx = await authenticate(req, { manage: true });
    await disconnectIntegration(ctx, id);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
