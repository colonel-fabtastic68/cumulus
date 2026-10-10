import { SQUARE_RANCH_SCOPES, beginSquareAuthorization, requireSquareConfig } from "@/lib/integrations/square";
import { appUrl, authenticate, jsonError, sharedAppUrl } from "@/lib/integrations/server";
import { assertIntegrationAllowed } from "@/lib/integrations/connect";
import { hasFeature } from "@/lib/instances";

export const maxDuration = 30;

/**
 * Starts Square's authorization code grant: stores a single-use state and
 * returns the consent URL. Square has one redirect URL per app, on the shared
 * host; a sign-in started on an instance keeps its state in the instance's
 * database (the state names the instance) and the callback hands it back.
 */
export async function POST(req: Request) {
  try {
    const config = requireSquareConfig();
    const ctx = await authenticate(req, { manage: true });
    assertIntegrationAllowed(ctx, "square");
    const url = ctx.instance
      ? await beginSquareAuthorization(ctx, sharedAppUrl(req), config, { instanceId: ctx.instance.id, scopes: hasFeature(ctx.instance, "ranch") ? SQUARE_RANCH_SCOPES : undefined })
      : await beginSquareAuthorization(ctx, appUrl(req), config);
    return Response.json({ url, environment: config.environment });
  } catch (e) {
    return jsonError(e);
  }
}
