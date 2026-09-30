import { authenticate, HttpError, jsonError } from "@/lib/integrations/server";
import { deleteDocumentFile } from "@/lib/server/documents";

export const maxDuration = 30;

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await authenticate(req, { write: true });
    const { id } = await params;
    const doc = await ctx.store.get("documents", id);
    if (!doc) throw new HttpError(404, "That document no longer exists.");
    await deleteDocumentFile(ctx.sa, doc);
    await ctx.store.remove("documents", id);
    return Response.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
