import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import { COLLECTIONS, type CollectionMap, type CollectionName, type WorkspaceSnapshot } from "@/lib/types";
import type { Store, WriteOp } from "@/lib/store/types";

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

/**
 * Reads the Firebase service account from FIREBASE_SERVICE_ACCOUNT_JSON (the
 * JSON file contents, on one line) or FIREBASE_SERVICE_ACCOUNT_B64 (the same
 * file base64-encoded, handy for env UIs that dislike multi-line values).
 */
export function readServiceAccount(): ServiceAccount | null {
  let raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() ?? "";
  if (!raw && process.env.FIREBASE_SERVICE_ACCOUNT_B64?.trim()) {
    try {
      raw = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64.trim(), "base64").toString("utf8");
    } catch {
      return null;
    }
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    return { ...parsed, private_key: parsed.private_key.replace(/\\n/g, "\n") } as ServiceAccount;
  } catch {
    return null;
  }
}

let app: App | null = null;

/** The one Admin SDK app for this process (Firestore and Auth share it). */
export function adminApp(sa: ServiceAccount): App {
  if (app) return app;
  app = getApps()[0] ?? initializeApp({ credential: cert({ projectId: sa.project_id, clientEmail: sa.client_email, privateKey: sa.private_key }), projectId: sa.project_id });
  return app;
}

/** Firestore rejects `undefined`; strip it recursively. */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripUndefined) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (v !== undefined) out[k] = stripUndefined(v);
    return out as T;
  }
  return value;
}

/** Top-level `undefined` in a patch means "clear this field", matching the client store. */
function patchPayload(patch: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) out[k] = v === undefined ? FieldValue.delete() : stripUndefined(v);
  return out;
}

/**
 * Server-side Store over the live workspace using the Admin SDK (bypasses
 * security rules, so only the server holds the credential). Reads go straight
 * to Firestore; there is no live subscription on the server.
 */
export class AdminFirestoreStore implements Store {
  readonly kind = "firestore" as const;
  private db: Firestore;
  private cache = new Map<CollectionName, unknown[]>();

  constructor(
    sa: ServiceAccount,
    private workspaceId: string,
  ) {
    this.db = getFirestore(adminApp(sa));
  }

  private col(name: CollectionName) {
    return this.db.collection(`workspaces/${this.workspaceId}/${name}`);
  }

  async ready() {}

  peek<C extends CollectionName>(name: C): CollectionMap[C][] {
    return (this.cache.get(name) ?? []) as CollectionMap[C][];
  }

  async list<C extends CollectionName>(name: C): Promise<CollectionMap[C][]> {
    const snap = await this.col(name).get();
    const rows = snap.docs.map((d) => d.data() as CollectionMap[C]);
    this.cache.set(name, rows);
    return rows;
  }

  async get<C extends CollectionName>(name: C, id: string): Promise<CollectionMap[C] | null> {
    const d = await this.col(name).doc(id).get();
    return d.exists ? (d.data() as CollectionMap[C]) : null;
  }

  subscribe<C extends CollectionName>(name: C, listener: (rows: CollectionMap[C][]) => void) {
    void this.list(name).then(listener);
    return () => {};
  }

  async put<C extends CollectionName>(name: C, doc: CollectionMap[C]) {
    await this.col(name).doc(doc.id).set(stripUndefined(doc));
  }

  async patch<C extends CollectionName>(name: C, id: string, patch: Partial<CollectionMap[C]>) {
    await this.col(name).doc(id).set(patchPayload(patch), { merge: true });
  }

  async remove<C extends CollectionName>(name: C, id: string) {
    await this.col(name).doc(id).delete();
  }

  async batch(ops: WriteOp[]) {
    for (let i = 0; i < ops.length; i += 450) {
      const b = this.db.batch();
      for (const op of ops.slice(i, i + 450)) {
        const ref = this.col(op.collection).doc(op.op === "put" ? op.doc.id : op.id);
        if (op.op === "put") b.set(ref, stripUndefined(op.doc));
        else if (op.op === "patch") b.set(ref, patchPayload(op.patch), { merge: true });
        else b.delete(ref);
      }
      await b.commit();
    }
  }

  async replaceAll(snapshot: WorkspaceSnapshot) {
    const ops: WriteOp[] = [];
    for (const name of COLLECTIONS) {
      const existing = await this.col(name).get();
      for (const d of existing.docs) ops.push({ op: "remove", collection: name, id: d.id });
    }
    for (const name of COLLECTIONS) for (const row of snapshot[name] as Array<{ id: string }>) ops.push({ op: "put", collection: name, doc: row } as WriteOp);
    await this.batch(ops);
  }

  async snapshot(): Promise<WorkspaceSnapshot> {
    const out = {} as Record<CollectionName, unknown[]>;
    for (const name of COLLECTIONS) out[name] = await this.list(name);
    return out as WorkspaceSnapshot;
  }
}
