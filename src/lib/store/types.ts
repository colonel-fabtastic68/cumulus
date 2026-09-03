import type { CollectionMap, CollectionName, WorkspaceSnapshot } from "@/lib/types";

export type StoreKind = "local" | "firestore";

export type WriteOp<C extends CollectionName = CollectionName> =
  | { op: "put"; collection: C; doc: CollectionMap[C] }
  | { op: "patch"; collection: C; id: string; patch: Partial<CollectionMap[C]> }
  | { op: "remove"; collection: C; id: string };

/**
 * Storage abstraction. Two implementations:
 *  - LocalStore: localStorage + BroadcastChannel (zero setup, works offline)
 *  - FirestoreStore: Google Cloud Firestore with real-time listeners
 *
 * All reads return plain JSON objects. Writes resolve when persisted.
 * `subscribe` fires immediately with the current rows, then on every change.
 */
export interface Store {
  readonly kind: StoreKind;
  /** Resolves once initial data has loaded. */
  ready(): Promise<void>;

  list<C extends CollectionName>(collection: C): Promise<CollectionMap[C][]>;
  get<C extends CollectionName>(collection: C, id: string): Promise<CollectionMap[C] | null>;
  /** Synchronous read from the in-memory cache (may be stale before ready()). */
  peek<C extends CollectionName>(collection: C): CollectionMap[C][];

  subscribe<C extends CollectionName>(
    collection: C,
    listener: (rows: CollectionMap[C][]) => void,
  ): () => void;

  put<C extends CollectionName>(collection: C, doc: CollectionMap[C]): Promise<void>;
  patch<C extends CollectionName>(collection: C, id: string, patch: Partial<CollectionMap[C]>): Promise<void>;
  remove<C extends CollectionName>(collection: C, id: string): Promise<void>;
  /** Apply several writes together. Atomic on Firestore, best-effort locally. */
  batch(ops: WriteOp[]): Promise<void>;

  /** Replace everything with the given snapshot. */
  replaceAll(snapshot: WorkspaceSnapshot): Promise<void>;
  /** Export everything. */
  snapshot(): Promise<WorkspaceSnapshot>;
}
