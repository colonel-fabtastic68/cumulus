import { buildSeed, freshWorkspace } from "@/lib/seed";
import { getRuntimeConfig } from "@/lib/firebase-config";
import { FirestoreStore, getFirebaseApp } from "./firestore";
import { LocalStore } from "./local";
import type { Store } from "./types";

export type { Store, StoreKind, WriteOp } from "./types";

let singleton: Store | null = null;

/**
 * Picks the backend:
 *  - Firestore when FIREBASE_* is configured (injected by the server at request time).
 *    A brand-new Firestore workspace starts empty and asks for the company name.
 *  - localStorage otherwise (zero-setup pilot mode, seeded with the demo company).
 */
export function createStore(): Store {
  if (singleton) return singleton;
  const { firebase: cfg, workspaceId } = getRuntimeConfig();
  if (cfg && typeof window !== "undefined") {
    const app = getFirebaseApp(cfg);
    singleton = new FirestoreStore(app, workspaceId, () => freshWorkspace());
  } else {
    singleton = new LocalStore(buildSeed);
  }
  return singleton;
}
