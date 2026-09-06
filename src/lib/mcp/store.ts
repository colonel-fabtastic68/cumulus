import { LocalStore } from "@/lib/store/local";
import { buildSeed } from "@/lib/seed";
import type { Store } from "@/lib/store/types";

export type ServerStoreMode = "demo" | "firestore";

export interface ServerStore {
  store: Store;
  mode: ServerStoreMode;
  /** Human-readable note about where the data comes from. */
  note: string;
}

let demoStore: Promise<ServerStore> | null = null;

/**
 * The store the MCP endpoint reads and writes.
 *
 * Today this is the seeded demo workspace held in memory for the lifetime of
 * the server process, so external agents can exercise every Nimbus tool
 * without touching anyone's real data. Writes land in that in-memory copy only.
 *
 * Groundwork for the real thing: when a server credential for the Firebase
 * project is configured (for example FIREBASE_SERVICE_ACCOUNT_JSON), return a
 * Firestore-backed Store scoped to CUMULUS_WORKSPACE via the Admin SDK so
 * remote agents see the same workspace as the app.
 */
export function getServerStore(): Promise<ServerStore> {
  if (!demoStore) {
    demoStore = (async () => {
      const store = new LocalStore(buildSeed);
      await store.replaceAll(buildSeed());
      return {
        store,
        mode: "demo" as const,
        note: "In-memory demo workspace (Halcyon Audio). Reads and writes stay inside this server process.",
      };
    })();
  }
  return demoStore;
}

/** Whether a server-side connection to the real workspace has been configured. */
export function firestoreServerConfigured(): boolean {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
}
