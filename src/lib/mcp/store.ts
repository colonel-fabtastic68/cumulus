import { LocalStore } from "@/lib/store/local";
import { buildSeed } from "@/lib/seed";
import { ENV_NAMES, cleanEnv } from "@/lib/firebase-config";
import type { Store } from "@/lib/store/types";
import { AdminFirestoreStore, readServiceAccount } from "./adminStore";

export type ServerStoreMode = "demo" | "firestore";

export interface ServerStore {
  store: Store;
  mode: ServerStoreMode;
  workspaceId: string;
  /** Human-readable note about where the data comes from. */
  note: string;
}

let cached: Promise<ServerStore> | null = null;

export function serverWorkspaceId(): string {
  for (const n of ENV_NAMES.workspaceId) {
    const v = cleanEnv(process.env[n]);
    if (v) return v;
  }
  return "default";
}

/** Whether the server can reach the real workspace (a service account is configured). */
export function firestoreServerConfigured(): boolean {
  return readServiceAccount() !== null;
}

/**
 * The store the MCP endpoint reads and writes.
 *
 * With FIREBASE_SERVICE_ACCOUNT_JSON configured this is the live workspace in
 * Firestore (the same one the app shows), through the Admin SDK. Otherwise it
 * falls back to an in-memory demo workspace so the endpoint can still be
 * exercised without exposing anyone's data.
 */
export function getServerStore(): Promise<ServerStore> {
  if (!cached) {
    cached = (async () => {
      const sa = readServiceAccount();
      const workspaceId = serverWorkspaceId();
      if (sa) {
        return {
          store: new AdminFirestoreStore(sa, workspaceId),
          mode: "firestore" as const,
          workspaceId,
          note: `Live workspace "${workspaceId}" in Firestore project ${sa.project_id}. Changes made here are real and show up in the app immediately.`,
        };
      }
      const store = new LocalStore(buildSeed);
      await store.replaceAll(buildSeed());
      return {
        store,
        mode: "demo" as const,
        workspaceId,
        note: "In-memory demo workspace (Halcyon Audio). Add FIREBASE_SERVICE_ACCOUNT_JSON on the server to serve the live workspace instead.",
      };
    })();
  }
  return cached;
}
