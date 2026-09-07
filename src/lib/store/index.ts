import { buildSeed, freshWorkspace } from "@/lib/seed";
import { getRuntimeConfig } from "@/lib/firebase-config";
import { EmptyStore } from "./empty";
import { FirestoreStore, getFirebaseApp } from "./firestore";
import { LocalStore } from "./local";
import type { Store } from "./types";

export type { Store, StoreKind, WriteOp } from "./types";

/** One store per workspace; switching tears down the previous workspace's listeners. */
const stores = new Map<string, Store>();

/**
 * Picks the backend:
 *  - Firestore when FIREBASE_* is configured (injected by the server at request time),
 *    bound to the given workspace. With no workspace open, an empty placeholder.
 *  - localStorage otherwise (zero-setup pilot mode, seeded with the demo company).
 */
export function createStore(workspaceId: string | null): Store {
  const { firebase: cfg } = getRuntimeConfig();
  if (cfg && typeof window !== "undefined") {
    const key = workspaceId ?? "";
    const existing = stores.get(key);
    if (existing) return existing;
    for (const [k, s] of stores) {
      if (k === key) continue;
      if (s instanceof FirestoreStore) s.dispose();
      stores.delete(k);
    }
    const store: Store = workspaceId ? new FirestoreStore(getFirebaseApp(cfg), workspaceId, () => freshWorkspace()) : new EmptyStore();
    stores.set(key, store);
    return store;
  }
  let local = stores.get("local");
  if (!local) {
    local = new LocalStore(buildSeed);
    stores.set("local", local);
  }
  return local;
}
