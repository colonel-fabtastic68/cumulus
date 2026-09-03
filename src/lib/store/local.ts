import { COLLECTIONS, type CollectionMap, type CollectionName, type WorkspaceSnapshot } from "@/lib/types";
import type { Store, WriteOp } from "./types";

const STORAGE_KEY = "cumulus:workspace:v1";
const CHANNEL = "cumulus:sync";

type Listener = (rows: unknown[]) => void;

/**
 * Zero-setup store backed by localStorage.
 * Cross-tab changes are broadcast with BroadcastChannel, so opening two tabs
 * demonstrates the collaborative, real-time behaviour without a backend.
 */
export class LocalStore implements Store {
  readonly kind = "local" as const;
  private data: WorkspaceSnapshot;
  private listeners = new Map<CollectionName, Set<Listener>>();
  private channel: BroadcastChannel | null = null;
  private readyPromise: Promise<void>;
  private tabId = Math.random().toString(36).slice(2);

  constructor(private seed: () => WorkspaceSnapshot) {
    this.data = emptySnapshot();
    this.readyPromise = Promise.resolve().then(() => this.load());
    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = (ev: MessageEvent) => {
        const msg = ev.data as { from: string; collections?: CollectionName[] };
        if (!msg || msg.from === this.tabId) return;
        this.load(false);
        const cols = msg.collections ?? COLLECTIONS;
        for (const c of cols) this.emit(c);
      };
    }
    if (typeof window !== "undefined") {
      window.addEventListener("storage", (ev) => {
        if (ev.key === STORAGE_KEY) {
          this.load(false);
          for (const c of COLLECTIONS) this.emit(c);
        }
      });
    }
  }

  private load(seedIfEmpty = true) {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<WorkspaceSnapshot>;
        this.data = { ...emptySnapshot(), ...parsed };
        return;
      } catch {
        // fall through to seed
      }
    }
    if (seedIfEmpty) {
      this.data = this.seed();
      this.persist();
    }
  }

  private persist(changed?: CollectionName[]) {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    this.channel?.postMessage({ from: this.tabId, collections: changed });
  }

  private emit(collection: CollectionName) {
    const set = this.listeners.get(collection);
    if (!set) return;
    const rows = this.data[collection] as unknown[];
    for (const l of set) l(rows);
  }

  ready() {
    return this.readyPromise;
  }

  peek<C extends CollectionName>(collection: C): CollectionMap[C][] {
    return this.data[collection] as CollectionMap[C][];
  }

  async list<C extends CollectionName>(collection: C): Promise<CollectionMap[C][]> {
    await this.readyPromise;
    return this.data[collection] as CollectionMap[C][];
  }

  async get<C extends CollectionName>(collection: C, id: string): Promise<CollectionMap[C] | null> {
    await this.readyPromise;
    const rows = this.data[collection] as CollectionMap[C][];
    return rows.find((r) => r.id === id) ?? null;
  }

  subscribe<C extends CollectionName>(collection: C, listener: (rows: CollectionMap[C][]) => void) {
    let set = this.listeners.get(collection);
    if (!set) {
      set = new Set();
      this.listeners.set(collection, set);
    }
    const l = listener as Listener;
    set.add(l);
    // Fire immediately with current rows
    this.readyPromise.then(() => l(this.data[collection] as unknown[]));
    return () => {
      set!.delete(l);
    };
  }

  private applyOp(op: WriteOp) {
    const rows = this.data[op.collection] as Array<{ id: string }>;
    if (op.op === "put") {
      const idx = rows.findIndex((r) => r.id === op.doc.id);
      if (idx >= 0) rows[idx] = op.doc;
      else rows.push(op.doc);
    } else if (op.op === "patch") {
      const idx = rows.findIndex((r) => r.id === op.id);
      if (idx >= 0) rows[idx] = { ...rows[idx], ...op.patch };
    } else if (op.op === "remove") {
      const idx = rows.findIndex((r) => r.id === op.id);
      if (idx >= 0) rows.splice(idx, 1);
    }
    // Replace array reference so React consumers see a new identity.
    (this.data as Record<string, unknown[]>)[op.collection] = [...rows];
  }

  async put<C extends CollectionName>(collection: C, doc: CollectionMap[C]) {
    await this.batch([{ op: "put", collection, doc }]);
  }

  async patch<C extends CollectionName>(collection: C, id: string, patch: Partial<CollectionMap[C]>) {
    await this.batch([{ op: "patch", collection, id, patch }]);
  }

  async remove<C extends CollectionName>(collection: C, id: string) {
    await this.batch([{ op: "remove", collection, id }]);
  }

  async batch(ops: WriteOp[]) {
    await this.readyPromise;
    const changed = new Set<CollectionName>();
    for (const op of ops) {
      this.applyOp(op);
      changed.add(op.collection);
    }
    this.persist(Array.from(changed));
    for (const c of changed) this.emit(c);
  }

  async replaceAll(snapshot: WorkspaceSnapshot) {
    await this.readyPromise;
    this.data = { ...emptySnapshot(), ...snapshot };
    this.persist(COLLECTIONS);
    for (const c of COLLECTIONS) this.emit(c);
  }

  async snapshot(): Promise<WorkspaceSnapshot> {
    await this.readyPromise;
    return JSON.parse(JSON.stringify(this.data)) as WorkspaceSnapshot;
  }
}

export function emptySnapshot(): WorkspaceSnapshot {
  return {
    items: [],
    movements: [],
    lots: [],
    suppliers: [],
    receipts: [],
    builds: [],
    orders: [],
    rmas: [],
    members: [],
    activity: [],
    integrations: [],
    settings: [],
    agentSessions: [],
  };
}
