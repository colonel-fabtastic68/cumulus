import { beginAuthorization, requireQuickbooksConfig } from "@/lib/integrations/quickbooks";
import { appUrl, authenticate, jsonError } from "@/lib/integrations/server";

export const maxDuration = 30;

/** Starts the OAuth 2.0 flow: stores a single-use state for this workspace and returns Intuit's authorisation URL. */
export async function POST(req: Request) {
  try {
    const config = requireQuickbooksConfig();
    const ctx = await authenticate(req, { manage: true });
    const url = await beginAuthorization(ctx, appUrl(req), config);
    const u = new URL(url);
    // Diagnostic: which host/path the browser is sent to and which params are present (the state and secret are never logged).
    console.log("[quickbooks] authorize", { to: `${u.origin}${u.pathname}`, params: [...u.searchParams.keys()], clientIdPrefix: u.searchParams.get("client_id")?.slice(0, 6), redirectUri: u.searchParams.get("redirect_uri"), base: appUrl(req) });
    return Response.json({ url, environment: config.environment });
  } catch (e) {
    return jsonError(e);
  }
}
