import { beginSquareAuthorization, requireSquareConfig } from "@/lib/integrations/square";
import { appUrl, authenticate, jsonError } from "@/lib/integrations/server";

export const maxDuration = 30;

/** Starts Square's authorization code grant: stores a single-use state and returns the consent URL. */
export async function POST(req: Request) {
  try {
    const config = requireSquareConfig();
    const ctx = await authenticate(req, { manage: true });
    const url = await beginSquareAuthorization(ctx, appUrl(req), config);
    return Response.json({ url, environment: config.environment });
  } catch (e) {
    return jsonError(e);
  }
}
