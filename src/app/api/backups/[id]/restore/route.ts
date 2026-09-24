import { restoreBackup } from "@/lib/server/backups";
import { authenticate, jsonError } from "@/lib/integrations/server";

export const maxDuration = 300;

/** Rolls the workspace back to a backup. A safety backup is taken first. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await authenticate(req, { manage: true });
    const { id } = await params;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response("Bad id", { status: 400 });
    const result = await restoreBackup(ctx, id);
    return Response.json(result);
  } catch (e) {
    return jsonError(e);
  }
}
