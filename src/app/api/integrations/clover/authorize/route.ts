import { beginCloverAuthorization, requireCloverConfig } from "@/lib/integrations/clover";
import { appUrl, authenticate, jsonError } from "@/lib/integrations/server";

export const maxDuration = 30;

/** Starts Clover's v2 authorization code grant: stores a single-use state and returns the consent URL. */
export async function POST(req: Request) {
  try {
    const config = requireCloverConfig();
    const ctx = await authenticate(req, { manage: true });
    const url = await beginCloverAuthorization(ctx, appUrl(req), config);
    return Response.json({ url, environment: config.environment, region: config.region });
  } catch (e) {
    return jsonError(e);
  }
}
