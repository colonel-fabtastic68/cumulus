import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
  getDocs,
  getDoc,
  setDoc,
  writeBatch,
  deleteDoc,
  deleteField,
  type Firestore,
} from "firebase/firestore";
import { COLLECTIONS, type CollectionMap, type CollectionName, type WorkspaceSnapshot } from "@/lib/types";
import type { Store, WriteOp } from "./types";

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
}

/** Reads NEXT_PUBLIC_FIREBASE_* env vars. Returns null when not configured. */
export function readFirebaseConfig(): FirebaseConfig | null {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;
  if (!apiKey || !projectId || !appId) return null;
  return {
    apiKey,
    projectId,
    appId,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? `${projectId}.firebaseapp.com`,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  };
}

export function getFirebaseApp(config: FirebaseConfig): FirebaseApp {
  return getApps()[0] ?? initializeApp(config);
}

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

  constructor(
    app: FirebaseApp,
    private workspaceId: string,
    private seed: () => WorkspaceSnapshot,
  ) {
    this.db = getFirestore(app);
    this.cache = {
      items: [], movements: [], lots: [], suppliers: [], receipts: [], builds: [], orders: [],
      rmas: [], members: [], activity: [], integrations: [], settings: [], agentSessions: [],
    };
    this.readyPromise = this.init();
  }

  private col(name: CollectionName) {
    return collection(this.db, "workspaces", this.workspaceId, name);
  }

  private async init() {
    // Seed an empty workspace on first use.
    const settingsSnap = await getDocs(this.col("settings"));
    if (settingsSnap.empty) {
      await this.replaceAll(this.seed());
    }
    const firstLoads: Promise<void>[] = [];
    for (const name of COLLECTIONS) {
      let resolveFirst!: () => void;
      firstLoads.push(new Promise<void>((r) => (resolveFirst = r)));
      const unsub = onSnapshot(this.col(name), (snap) => {
        const rows = snap.docs.map((d) => d.data());
        (this.cache as Record<string, unknown[]>)[name] = rows;
        this.emit(name);
        resolveFirst();
      });
      this.unsubs.push(unsub);
    }
    await Promise.all(firstLoads);
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
    await this.readyPromise;
    return this.cache[name] as CollectionMap[C][];
  }

  async get<C extends CollectionName>(name: C, id: string): Promise<CollectionMap[C] | null> {
    await this.readyPromise;
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
    this.readyPromise.then(() => l(this.cache[name] as unknown[]));
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
    await this.readyPromise;
    return JSON.parse(JSON.stringify(this.cache)) as WorkspaceSnapshot;
  }

  dispose() {
    for (const u of this.unsubs) u();
  }
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
