import { getStorage } from "firebase-admin/storage";
import type { WorkspaceDocument } from "@/lib/types";
import { adminApp, type ServiceAccount } from "@/lib/mcp/adminStore";
import { HttpError } from "@/lib/integrations/server";

/**
 * Files behind the Documents library live in the project's storage bucket at
 * workspaces/{ws}/documents/{id}/{name}. Only the server touches the bucket;
 * the browser gets short-lived signed URLs to read them.
 */

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

export function bucketName(sa: ServiceAccount): string {
  const configured = process.env.FIREBASE_STORAGE_BUCKET?.trim().replace(/^gs:\/\//, "").replace(/^["']+|["']+$/g, "");
  return configured || `${sa.project_id}.firebasestorage.app`;
}

function bucket(sa: ServiceAccount) {
  return getStorage(adminApp(sa)).bucket(bucketName(sa));
}

export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return (cleaned || "file").slice(0, 160);
}

/** A bespoke instance's files sit under instances/{id}/ so they never share a prefix with the shared product's workspaces. */
export function documentPath(workspaceId: string, id: string, name: string, instance?: { id: string } | null): string {
  return `${instance ? `instances/${instance.id}/` : ""}workspaces/${workspaceId}/documents/${id}/${safeFileName(name)}`;
}

export async function uploadDocumentFile(sa: ServiceAccount, path: string, data: Buffer, mime: string): Promise<void> {
  try {
    await bucket(sa).file(path).save(data, { contentType: mime || "application/octet-stream", resumable: false, metadata: { cacheControl: "private, max-age=0" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/bucket|not found|does not exist/i.test(message)) throw new HttpError(503, `The storage bucket ${bucketName(sa)} is not available. Enable Storage for the Firebase project (or set FIREBASE_STORAGE_BUCKET) and try again.`);
    throw new HttpError(502, `Could not store the file: ${message}`);
  }
}

/** A read link that works for a quarter of an hour. */
export async function signedDocumentUrl(sa: ServiceAccount, doc: WorkspaceDocument): Promise<string> {
  if (!doc.storagePath) throw new HttpError(404, "This document has no stored file.");
  const [url] = await bucket(sa)
    .file(doc.storagePath)
    .getSignedUrl({ action: "read", expires: Date.now() + 15 * 60_000, responseDisposition: `inline; filename="${safeFileName(doc.name).replace(/"/g, "")}"` });
  return url;
}

export async function deleteDocumentFile(sa: ServiceAccount, doc: WorkspaceDocument): Promise<void> {
  if (!doc.storagePath) return;
  await bucket(sa).file(doc.storagePath).delete({ ignoreNotFound: true });
}
