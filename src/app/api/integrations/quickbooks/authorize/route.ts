import { beginAuthorization, requireQuickbooksConfig } from "@/lib/integrations/quickbooks";
import { appUrl, authenticate, jsonError } from "@/lib/integrations/server";

export const maxDuration = 30;

/** Starts the OAuth 2.0 flow: stores a single-use state for this workspace and returns Intuit's authorisation URL. */
export async function POST(req: Request) {
  try {
    const config = requireQuickbooksConfig();
    const ctx = await authenticate(req, { manage: true });
    const url = await beginAuthorization(ctx, appUrl(req), config);
    return Response.json({ url, environment: config.environment });
  } catch (e) {
    return jsonError(e);
  }
}
