import { runtimeConfigFromEnv } from "@/lib/firebase-config";
import { authenticate, HttpError } from "@/lib/integrations/server";

/**
 * Strato's import helpers (reading paper, filling gaps) spend model calls, so
 * a hosted install only serves signed-in workspace members. A local install
 * (no Firebase config, so no accounts) serves the browser as is.
 */
export async function authenticateForStrato(req: Request): Promise<{ workspaceId: string | null }> {
  if (req.headers.get("authorization")) {
    const ctx = await authenticate(req);
    return { workspaceId: ctx.workspaceId };
  }
  if (runtimeConfigFromEnv().firebase) throw new HttpError(401, "Sign in first.");
  return { workspaceId: null };
}
