"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CollectionMap, CollectionName, Item, WorkspaceSettings } from "@/lib/types";
import { seedSettings } from "@/lib/seed";
import { createStore } from "./index";
import type { Store } from "./types";

interface StoreContextValue {
  store: Store;
  ready: boolean;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState<Store>(() => createStore());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    store.ready().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [store]);

  const value = useMemo(() => ({ store, ready }), [store, ready]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStoreContext(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}

export function useStore(): Store {
  return useStoreContext().store;
}

/** Live rows for a collection. Re-renders on every change (local or remote). */
export function useCollection<C extends CollectionName>(name: C): CollectionMap[C][] {
  const { store } = useStoreContext();
  const [rows, setRows] = useState<CollectionMap[C][]>(() => store.peek(name));
  useEffect(() => store.subscribe(name, setRows), [store, name]);
  return rows;
}

export function useDoc<C extends CollectionName>(name: C, id: string | undefined): CollectionMap[C] | undefined {
  const rows = useCollection(name);
  return useMemo(() => (id ? rows.find((r) => r.id === id) : undefined), [rows, id]);
}

export function useSettings(): WorkspaceSettings {
  const rows = useCollection("settings");
  return rows[0] ?? seedSettings();
}

export function useItems(): Item[] {
  return useCollection("items");
}

export function useItemsById(): Map<string, Item> {
  const items = useItems();
  return useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
}

export function useItemsBySku(): Map<string, Item> {
  const items = useItems();
  return useMemo(() => new Map(items.map((i) => [i.sku.toUpperCase(), i])), [items]);
}
