"use client";

import { useCallback } from "react";
import { useSession } from "@/lib/session";
import { getFirebaseAuth } from "@/lib/store/firestore";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type ApiCall = <T = unknown>(path: string, body?: unknown, init?: { method?: string }) => Promise<T>;

/**
 * Calls the app's own API routes as the signed-in account: sends the Firebase
 * ID token and the open workspace id, and turns error bodies into messages.
 * Live connections (channels, carriers) only exist in Firestore mode.
 */
export function useApi(): ApiCall {
  const { app, workspaceId, mode } = useSession();
  return useCallback(
    async <T,>(path: string, body?: unknown, init?: { method?: string }): Promise<T> => {
      if (mode !== "firestore" || !app || !workspaceId) throw new ApiError(0, "Live connections run in Firestore mode with a signed-in account. This install is in local mode.");
      const user = getFirebaseAuth(app).currentUser;
      if (!user) throw new ApiError(401, "Sign in first.");
      const token = await user.getIdToken();
      const res = await fetch(path, {
        method: init?.method ?? "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "x-workspace-id": workspaceId },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!res.ok) {
        const message = (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
        throw new ApiError(res.status, message);
      }
      return data as T;
    },
    [app, workspaceId, mode],
  );
}
