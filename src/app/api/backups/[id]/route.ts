import { deleteBackup } from "@/lib/server/backups";
import { authenticate, jsonError } from "@/lib/integrations/server";

export const maxDuration = 60;

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await authenticate(req, { manage: true });
    const { id } = await params;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return new Response("Bad id", { status: 400 });
    await deleteBackup(ctx.db, ctx.workspaceId, id);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
