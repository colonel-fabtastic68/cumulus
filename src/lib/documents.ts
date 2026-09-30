"use client";

import { useCallback, useMemo } from "react";
import type { DocumentUse, WorkspaceDocument } from "@/lib/types";
import { useSession } from "@/lib/session";
import { getFirebaseAuth } from "@/lib/store/firestore";
import { useCollection, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { useApi } from "@/lib/api-client";
import { newId, nowIso } from "@/lib/utils";

export const DOCUMENT_USES: Array<{ value: DocumentUse; label: string }> = [
  { value: "general", label: "General" },
  { value: "purchase-orders", label: "Purchase orders" },
  { value: "sales-orders", label: "Sales orders" },
  { value: "quotes", label: "Quotes" },
  { value: "receiving", label: "Receiving" },
];

export function documentUseLabel(use?: DocumentUse): string {
  return DOCUMENT_USES.find((u) => u.value === use)?.label ?? "General";
}

export interface UploadDocumentInput {
  file: File;
  name?: string;
  folder?: string;
  kind: WorkspaceDocument["kind"];
  useFor?: DocumentUse;
  description?: string;
}

const LOCAL_MAX = 3 * 1024 * 1024;

/**
 * The Documents library from the browser. Hosted workspaces store files in
 * the project's bucket through the documents API; local mode keeps small
 * files inline so the feature works without a server.
 */
export function useDocuments() {
  const { mode, app, workspaceId } = useSession();
  const api = useApi();
  const store = useStore();
  const user = useCurrentUser();
  const documents = useCollection("documents");

  const upload = useCallback(
    async (input: UploadDocumentInput): Promise<WorkspaceDocument> => {
      if (mode === "firestore") {
        const form = new FormData();
        form.set("file", input.file);
        if (input.name) form.set("name", input.name);
        if (input.folder) form.set("folder", input.folder);
        form.set("kind", input.kind);
        if (input.useFor) form.set("useFor", input.useFor);
        if (input.description) form.set("description", input.description);
        const token = await getFirebaseAuth(app!).currentUser?.getIdToken();
        const res = await fetch("/api/documents", { method: "POST", headers: { Authorization: `Bearer ${token}`, "x-workspace-id": workspaceId ?? "" }, body: form });
        const data = (await res.json().catch(() => ({}))) as { document?: WorkspaceDocument; error?: string };
        if (!res.ok || !data.document) throw new Error(data.error ?? `Upload failed (${res.status})`);
        return data.document;
      }
      if (input.file.size > LOCAL_MAX) throw new Error("Local mode keeps files up to 3 MB in this browser. Sign in to a hosted workspace for larger files.");
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("Could not read the file"));
        r.readAsDataURL(input.file);
      });
      const now = nowIso();
      const doc: WorkspaceDocument = { id: newId("doc"), name: input.name?.trim() || input.file.name, folder: input.folder?.trim() || undefined, kind: input.kind, useFor: input.kind === "template" ? (input.useFor ?? "general") : input.useFor, description: input.description?.trim() || undefined, mime: input.file.type || "application/octet-stream", size: input.file.size, dataUrl, uploadedBy: user.id, createdAt: now, updatedAt: now };
      await store.put("documents", doc);
      return doc;
    },
    [mode, app, workspaceId, store, user.id],
  );

  /** Opens the file in a new tab. The tab is opened at click time so pop-up blockers allow it, then pointed at the file. */
  const open = useCallback(
    async (doc: WorkspaceDocument): Promise<void> => {
      const tab = window.open("", "_blank");
      try {
        let url: string;
        if (doc.dataUrl) {
          const blob = await (await fetch(doc.dataUrl)).blob();
          url = URL.createObjectURL(blob);
        } else {
          url = (await api<{ url: string }>(`/api/documents/${encodeURIComponent(doc.id)}/url`, undefined, { method: "GET" })).url;
        }
        if (tab) tab.location.href = url;
        else window.location.assign(url);
      } catch (e) {
        tab?.close();
        throw e;
      }
    },
    [api],
  );

  const update = useCallback(
    async (id: string, patch: Partial<Pick<WorkspaceDocument, "name" | "folder" | "kind" | "useFor" | "description">>): Promise<void> => {
      await store.patch("documents", id, { ...patch, updatedAt: nowIso() });
    },
    [store],
  );

  const remove = useCallback(
    async (doc: WorkspaceDocument): Promise<void> => {
      if (mode === "firestore" && doc.storagePath) await api(`/api/documents/${encodeURIComponent(doc.id)}`, undefined, { method: "DELETE" });
      else await store.remove("documents", doc.id);
    },
    [mode, api, store],
  );

  const templatesFor = useCallback((use: DocumentUse) => documents.filter((d) => d.kind === "template" && d.useFor === use).sort((a, b) => a.name.localeCompare(b.name)), [documents]);

  return useMemo(() => ({ documents, upload, open, update, remove, templatesFor, where: mode === "firestore" ? ("server" as const) : ("browser" as const) }), [documents, upload, open, update, remove, templatesFor, mode]);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
