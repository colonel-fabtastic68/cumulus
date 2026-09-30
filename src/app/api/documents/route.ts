import type { DocumentUse, WorkspaceDocument } from "@/lib/types";
import { activityOp } from "@/lib/inventory";
import { authenticate, HttpError, jsonError } from "@/lib/integrations/server";
import { documentPath, MAX_DOCUMENT_BYTES, uploadDocumentFile } from "@/lib/server/documents";
import { newId, nowIso } from "@/lib/utils";

export const maxDuration = 120;

const USES: DocumentUse[] = ["purchase-orders", "sales-orders", "quotes", "receiving", "general"];

/** Uploads a file into the workspace's Documents library (multipart: file + folder, kind, useFor, description). */
export async function POST(req: Request) {
  try {
    const ctx = await authenticate(req, { write: true });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof File)) throw new HttpError(400, "Attach a file.");
    if (file.size === 0) throw new HttpError(400, "That file is empty.");
    if (file.size > MAX_DOCUMENT_BYTES) throw new HttpError(413, "Files up to 25 MB can be stored here.");
    const field = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v.trim() : "";
    };
    const id = newId("doc");
    const name = field("name") || file.name || "Untitled";
    const kind = field("kind") === "template" ? "template" : "document";
    const useFor = USES.includes(field("useFor") as DocumentUse) ? (field("useFor") as DocumentUse) : undefined;
    const storagePath = documentPath(ctx.workspaceId, id, name);
    await uploadDocumentFile(ctx.sa, storagePath, Buffer.from(await file.arrayBuffer()), file.type);
    const now = nowIso();
    const doc: WorkspaceDocument = {
      id,
      name,
      folder: field("folder") || undefined,
      kind,
      useFor: kind === "template" ? (useFor ?? "general") : useFor,
      description: field("description") || undefined,
      mime: file.type || "application/octet-stream",
      size: file.size,
      storagePath,
      uploadedBy: ctx.actor.id,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.store.batch([{ op: "put", collection: "documents", doc }, activityOp(ctx.actor, "settings.updated", `${ctx.actor.name} added ${kind === "template" ? "template" : "document"} “${name}”${doc.folder ? ` to ${doc.folder}` : ""}`, { meta: { documentId: id, size: file.size } })]);
    return Response.json({ document: doc });
  } catch (e) {
    return jsonError(e);
  }
}
