"use client";

import { useCallback } from "react";
import { ApiError } from "@/lib/api-client";
import { useSession } from "@/lib/session";
import { getFirebaseAuth } from "@/lib/store/firestore";

/**
 * Calls Strato's import helpers (/api/import/extract, /api/import/enrich).
 * Hosted accounts send their token and workspace like every other API call;
 * a local install has no accounts, so the routes serve it plainly.
 */
export function useStratoImportApi() {
  const { app, workspaceId, mode } = useSession();
  return useCallback(
    async <T,>(path: string, body: unknown): Promise<T> => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (mode === "firestore" && app && workspaceId) {
        const user = getFirebaseAuth(app).currentUser;
        if (!user) throw new ApiError(401, "Sign in first.");
        headers.Authorization = `Bearer ${await user.getIdToken()}`;
        headers["x-workspace-id"] = workspaceId;
      }
      const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
      const text = await res.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
      return data as T;
    },
    [app, workspaceId, mode],
  );
}
