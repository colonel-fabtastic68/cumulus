import { beginShippoAuthorization, requireShippoOAuthConfig } from "@/lib/integrations/shippoOAuth";
import { appUrl, authenticate, jsonError } from "@/lib/integrations/server";

export const maxDuration = 30;

/** Starts the Shippo sign-in for this workspace: stores a single-use state and returns the consent URL. */
export async function POST(req: Request) {
  try {
    const config = requireShippoOAuthConfig();
    const ctx = await authenticate(req, { manage: true });
    const url = await beginShippoAuthorization(ctx, appUrl(req), config);
    return Response.json({ url });
  } catch (e) {
    return jsonError(e);
  }
}
