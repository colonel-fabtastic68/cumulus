import { connectIntegration, type ConnectBody } from "@/lib/integrations/connect";
import { HttpError, authenticate, isIntegrationId, jsonError, readJson } from "@/lib/integrations/server";

export const maxDuration = 60;

/** Verifies credentials with the platform, stores them server-side and registers webhooks. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isIntegrationId(id)) throw new HttpError(404, "Unknown integration.");
    const ctx = await authenticate(req, { manage: true });
    const body = await readJson<ConnectBody>(req);
    const integration = await connectIntegration(ctx, req, id, body);
    return Response.json({ integration });
  } catch (e) {
    return jsonError(e);
  }
}
