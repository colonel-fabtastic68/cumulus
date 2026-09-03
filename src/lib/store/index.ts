import { buildSeed } from "@/lib/seed";
import { FirestoreStore, getFirebaseApp, readFirebaseConfig } from "./firestore";
import { LocalStore } from "./local";
import type { Store } from "./types";

export type { Store, StoreKind, WriteOp } from "./types";

let singleton: Store | null = null;

/**
 * Picks the backend:
 *  - Firestore when NEXT_PUBLIC_FIREBASE_* is configured
 *  - localStorage otherwise (zero-setup pilot mode)
 */
export function createStore(): Store {
  if (singleton) return singleton;
  const cfg = readFirebaseConfig();
  if (cfg && typeof window !== "undefined") {
    const app = getFirebaseApp(cfg);
    const workspaceId = process.env.NEXT_PUBLIC_CUMULUS_WORKSPACE ?? "default";
    singleton = new FirestoreStore(app, workspaceId, buildSeed);
  } else {
    singleton = new LocalStore(buildSeed);
  }
  return singleton;
}
