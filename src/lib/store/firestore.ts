import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { browserLocalPersistence, getAuth, indexedDBLocalPersistence, initializeAuth, onAuthStateChanged, type Auth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  onSnapshot,
  getDocs,
  getDoc,
  setDoc,
  writeBatch,
  deleteDoc,
  deleteField,
  waitForPendingWrites,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS, type CollectionMap, type CollectionName, type WorkspaceSnapshot } from "@/lib/types";
import { getRuntimeConfig, type FirebaseConfig } from "@/lib/firebase-config";
import { debugLog } from "@/lib/debug";
import type { Store, WriteOp } from "./types";

export type { FirebaseConfig } from "@/lib/firebase-config";

/** Active Firebase config (server-injected at request time, else build-time values). Null when not configured. */
export function readFirebaseConfig(): FirebaseConfig | null {
  return getRuntimeConfig().firebase;
}

export function getFirebaseApp(config: FirebaseConfig): FirebaseApp {
  return getApps()[0] ?? initializeApp(config);
}

const auths = new WeakMap<FirebaseApp, Auth>();

/**
 * Firebase Auth without a popup/redirect resolver. The default getAuth() loads
 * the auth iframe and Google's gapi at start-up to look for redirect results,
 * and the first auth state waits for it; Cumulus only signs in with passwords
 * and email links, so none of that is needed.
 */
export function getFirebaseAuth(app: FirebaseApp): Auth {
  const existing = auths.get(app);
  if (existing) return existing;
  let auth: Auth;
  try {
    auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  } catch {
    auth = getAuth(app);
  }
  auths.set(app, auth);
  return auth;
}

const dbs = new WeakMap<FirebaseApp, Firestore>();

/**
 * The Firestore instance, created once per app with the IndexedDB cache on so
 * repeat page loads render from disk while the live snapshots catch up. Every
 * Firestore call in the browser must go through here: initializing twice with
 * different settings throws, and a plain getFirestore() would lose the cache.
 */
export function getDb(app: FirebaseApp): Firestore {
  const existing = dbs.get(app);
  if (existing) return existing;
  let db: Firestore;
  try {
    db = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      // Fall back to long polling when a proxy, extension or Safari blocks the streaming channel.
      experimentalAutoDetectLongPolling: true,
    });
  } catch {
    // Already initialised without these settings (or persistence unavailable): keep going without the disk cache.
    db = getFirestore(app);
  }
  dbs.set(app, db);
  return db;
}

/** Collections the app needs before it can render. The history-heavy ones stream in behind them. */
const CORE_COLLECTIONS: CollectionName[] = ["settings", "members", "items", "suppliers", "orders", "rmas", "integrations"];

/**
 * Firestore-backed store. Every collection lives under
 * `workspaces/{workspaceId}/{collection}` and is mirrored into memory via
 * onSnapshot so reads are instant and every tab/user sees changes live.
 */
export class FirestoreStore implements Store {
  readonly kind = "firestore" as const;
  private db: Firestore;
  private cache: WorkspaceSnapshot;
  private listeners = new Map<CollectionName, Set<(rows: unknown[]) => void>>();
  private unsubs: Array<() => void> = [];
  private readyPromise: Promise<void>;
  /** Resolves per collection once its first snapshot (cache or server) has landed. */
  private firstLoad = new Map<CollectionName, Promise<void>>();
  private firstLoadResolve = new Map<CollectionName, () => void>();
  private firstLoadReject = new Map<CollectionName, (e: Error) => void>();
  private seeded = false;

  constructor(
    private app: FirebaseApp,
    private workspaceId: string,
    private seed: () => WorkspaceSnapshot,
  ) {
    this.db = getDb(app);
    this.cache = {
      items: [], movements: [], lots: [], suppliers: [], receipts: [], builds: [], orders: [],
      rmas: [], members: [], activity: [], integrations: [], settings: [], agentSessions: [],
      locations: [], transfers: [], shipments: [], quotes: [], channelTombstones: [],
    };
    for (const name of COLLECTIONS) {
      const p = new Promise<void>((resolve, reject) => {
        this.firstLoadResolve.set(name, resolve);
        this.firstLoadReject.set(name, reject);
      });
      // Awaited on demand; a failure surfaces through ready() or list(), not as an unhandled rejection.
      p.catch(() => {});
      this.firstLoad.set(name, p);
    }
    this.readyPromise = this.init();
  }

  private col(name: CollectionName) {
    return collection(this.db, "workspaces", this.workspaceId, name);
  }

  /** Resolves once Firebase Auth reports a signed-in user. Rules require auth, so reads must wait. */
  private waitForSignIn(): Promise<void> {
    return new Promise((resolve) => {
      const unsub = onAuthStateChanged(getFirebaseAuth(this.app), (user) => {
        if (user) {
          unsub();
          resolve();
        }
      });
    });
  }

  /**
   * Subscribe to every collection at once. The first snapshot of each comes from
   * the disk cache when there is one, so a returning visitor renders straight
   * away; the server snapshot follows and re-emits. ready() waits only for the
   * core collections, so a large movement history never blocks first paint.
   */
  private async init() {
    await this.waitForSignIn();
    // Joining a workspace writes the member record and the profile in one batch; the profile listener
    // fires before the server has acknowledged it. Reading before that acknowledgement is refused.
    await waitForPendingWrites(this.db).catch(() => {});
    debugLog(`store ${this.workspaceId}: subscribing`);
    for (const name of COLLECTIONS) {
      let first = true;
      const unsub = onSnapshot(
        this.col(name),
        (snap) => {
          (this.cache as Record<string, unknown[]>)[name] = snap.docs.map((d) => d.data());
          this.emit(name);
          if (first) {
            first = false;
            debugLog(`store ${name}: ${snap.size} docs (${snap.metadata.fromCache ? "cache" : "server"})`);
          }
          this.firstLoadResolve.get(name)?.();
          // A workspace with no settings on the server (pre-account era) is seeded once. Never decide that from the cache.
          if (name === "settings" && snap.empty && !snap.metadata.fromCache && !this.seeded) {
            this.seeded = true;
            void this.replaceAll(this.seed()).catch(() => {});
          }
        },
        (e) => this.firstLoadReject.get(name)?.(new Error(describeFirestoreError(e))),
      );
      this.unsubs.push(unsub);
    }
    await Promise.all(CORE_COLLECTIONS.map((name) => this.firstLoad.get(name)));
    debugLog(`store ${this.workspaceId}: ready`);
  }

  private emit(name: CollectionName) {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const l of set) l(this.cache[name] as unknown[]);
  }

  ready() {
    return this.readyPromise;
  }

  peek<C extends CollectionName>(name: C): CollectionMap[C][] {
    return this.cache[name] as CollectionMap[C][];
  }

  async list<C extends CollectionName>(name: C): Promise<CollectionMap[C][]> {
    await this.firstLoad.get(name);
    return this.cache[name] as CollectionMap[C][];
  }

  async get<C extends CollectionName>(name: C, id: string): Promise<CollectionMap[C] | null> {
    await this.firstLoad.get(name);
    const cached = (this.cache[name] as CollectionMap[C][]).find((r) => r.id === id);
    if (cached) return cached;
    const snap = await getDoc(doc(this.col(name), id));
    return snap.exists() ? (snap.data() as CollectionMap[C]) : null;
  }

  subscribe<C extends CollectionName>(name: C, listener: (rows: CollectionMap[C][]) => void) {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    const l = listener as (rows: unknown[]) => void;
    set.add(l);
    this.firstLoad.get(name)?.then(() => l(this.cache[name] as unknown[])).catch(() => {});
    return () => {
      set!.delete(l);
    };
  }

  async put<C extends CollectionName>(name: C, d: CollectionMap[C]) {
    await setDoc(doc(this.col(name), d.id), stripUndefined(d));
  }

  async patch<C extends CollectionName>(name: C, id: string, patch: Partial<CollectionMap[C]>) {
    await setDoc(doc(this.col(name), id), patchPayload(patch), { merge: true });
  }

  async remove<C extends CollectionName>(name: C, id: string) {
    await deleteDoc(doc(this.col(name), id));
  }

  async batch(ops: WriteOp[]) {
    // Firestore batches are limited to 500 ops.
    for (let i = 0; i < ops.length; i += 450) {
      const b = writeBatch(this.db);
      for (const op of ops.slice(i, i + 450)) {
        if (op.op === "put") b.set(doc(this.col(op.collection), op.doc.id), stripUndefined(op.doc));
        else if (op.op === "patch") b.set(doc(this.col(op.collection), op.id), patchPayload(op.patch), { merge: true });
        else b.delete(doc(this.col(op.collection), op.id));
      }
      await b.commit();
    }
  }

  async replaceAll(snapshot: WorkspaceSnapshot) {
    const ops: WriteOp[] = [];
    for (const name of COLLECTIONS) {
      const existing = await getDocs(this.col(name));
      for (const d of existing.docs) ops.push({ op: "remove", collection: name, id: d.id });
    }
    for (const name of COLLECTIONS) {
      for (const row of snapshot[name] as Array<{ id: string }>) {
        ops.push({ op: "put", collection: name, doc: row } as WriteOp);
      }
    }
    await this.batch(ops);
  }

  async snapshot(): Promise<WorkspaceSnapshot> {
    await Promise.all(COLLECTIONS.map((name) => this.firstLoad.get(name)));
    return JSON.parse(JSON.stringify(this.cache)) as WorkspaceSnapshot;
  }

  dispose() {
    for (const u of this.unsubs) u();
  }
}

/** Turn Firestore SDK errors into something a pilot user can act on. */
export function describeFirestoreError(e: unknown): string {
  const code = (e as { code?: string })?.code ?? "";
  const msg = e instanceof Error ? e.message : String(e);
  if (code.includes("permission-denied")) return "Firestore refused the request (permission denied). Deploy firestore.rules from this repo, or set your rules to allow signed-in users.";
  if (code.includes("unavailable") || /offline/i.test(msg)) return "Could not reach Firestore. Check that Cloud Firestore is enabled for the project in the Firebase console and that FIREBASE_PROJECT_ID is right.";
  if (code.includes("failed-precondition")) return "Firestore reported a failed precondition. Usually the database has not been created yet: open Firestore in the Firebase console and create it (Native mode).";
  if (code.includes("unauthenticated")) return "Firestore rejected the request as unauthenticated. Sign in again.";
  return `Firestore error: ${msg}`;
}

/**
 * For merge writes, a top-level `undefined` means "clear this field" (that is
 * how the local store behaves), so map it to deleteField(). Nested undefineds
 * are stripped.
 */
function patchPayload<T extends object>(patch: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = v === undefined ? deleteField() : stripUndefined(v);
  }
  return out;
}

/** Firestore rejects `undefined` values; strip them recursively. */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}
