import type { CollectionMap, CollectionName, WorkspaceSnapshot } from "@/lib/types";
import { freshWorkspace } from "@/lib/seed";
import type { Store } from "./types";

/** Placeholder store for a signed-in account with no workspace open. Reads are empty, writes refuse. */
export class EmptyStore implements Store {
  readonly kind = "firestore" as const;
  private snap: WorkspaceSnapshot = freshWorkspace();

  ready() {
    return Promise.resolve();
  }
  list<C extends CollectionName>(name: C): Promise<CollectionMap[C][]> {
    return Promise.resolve(this.snap[name] as CollectionMap[C][]);
  }
  get<C extends CollectionName>(): Promise<CollectionMap[C] | null> {
    return Promise.resolve(null);
  }
  peek<C extends CollectionName>(name: C): CollectionMap[C][] {
    return this.snap[name] as CollectionMap[C][];
  }
  subscribe<C extends CollectionName>(name: C, listener: (rows: CollectionMap[C][]) => void) {
    listener(this.peek(name));
    return () => {};
  }
  private refuse(): Promise<never> {
    return Promise.reject(new Error("Open or create a workspace first."));
  }
  put() {
    return this.refuse();
  }
  patch() {
    return this.refuse();
  }
  remove() {
    return this.refuse();
  }
  batch() {
    return this.refuse();
  }
  replaceAll() {
    return this.refuse();
  }
  snapshot(): Promise<WorkspaceSnapshot> {
    return Promise.resolve(this.snap);
  }
}
