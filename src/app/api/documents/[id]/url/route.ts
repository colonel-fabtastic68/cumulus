import { authenticate, HttpError, jsonError } from "@/lib/integrations/server";
import { signedDocumentUrl } from "@/lib/server/documents";

export const maxDuration = 30;

/** A short-lived link to read the file, for any member of the workspace. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await authenticate(req);
    const { id } = await params;
    const doc = await ctx.store.get("documents", id);
    if (!doc) throw new HttpError(404, "That document no longer exists.");
    return Response.json({ url: await signedDocumentUrl(ctx.sa, doc), name: doc.name, mime: doc.mime });
  } catch (e) {
    return jsonError(e);
  }
}
