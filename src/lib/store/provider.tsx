"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CollectionMap, CollectionName, Item, WorkspaceSettings } from "@/lib/types";
import { seedSettings } from "@/lib/seed";
import { createStore } from "./index";
import type { Store } from "./types";

interface StoreContextValue {
  store: Store;
  ready: boolean;
  /** Set when the backend failed to initialise (Firestore mode). */
  error: string | null;
}

const StoreContext = createContext<StoreContextValue | null>(null);

/**
 * A proposed change (usually from Nimbus) overlaid on the items collection so
 * tables and detail pages can show "what it would look like" before applying.
 */
export interface PreviewState {
  /** Identity of the proposal being previewed (the tool call id), so cards can tell whether it is theirs. */
  id?: string;
  label: string;
  /** itemId → fields that would change. */
  patches: Record<string, Partial<Item>>;
  /** true = show proposed values, false = show current values (rows stay highlighted). */
  showNew: boolean;
  apply?: () => Promise<void> | void;
  onDiscard?: () => void;
}

interface PreviewContextValue {
  preview: PreviewState | null;
  setPreview: (p: PreviewState | null) => void;
  setShowNew: (showNew: boolean) => void;
}

const PreviewContext = createContext<PreviewContextValue>({ preview: null, setPreview: () => {}, setShowNew: () => {} });

export function usePreview(): PreviewContextValue {
  return useContext(PreviewContext);
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [store] = useState<Store>(() => createStore());
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    store.ready().then(
      () => {
        if (!cancelled) setReady(true);
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store]);

  const value = useMemo(() => ({ store, ready, error }), [store, ready, error]);

  const [preview, setPreviewState] = useState<PreviewState | null>(null);
  const setPreview = useCallback((p: PreviewState | null) => setPreviewState(p), []);
  const setShowNew = useCallback((showNew: boolean) => setPreviewState((p) => (p ? { ...p, showNew } : p)), []);
  const previewValue = useMemo(() => ({ preview, setPreview, setShowNew }), [preview, setPreview, setShowNew]);

  return (
    <StoreContext.Provider value={value}>
      <PreviewContext.Provider value={previewValue}>{children}</PreviewContext.Provider>
    </StoreContext.Provider>
  );
}

export function useStoreContext(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside <StoreProvider>");
  return ctx;
}

export function useStore(): Store {
  return useStoreContext().store;
}

/** Live rows for a collection. Re-renders on every change (local or remote). Items reflect an active preview. */
export function useCollection<C extends CollectionName>(name: C): CollectionMap[C][] {
  const { store } = useStoreContext();
  const { preview } = usePreview();
  const [rows, setRows] = useState<CollectionMap[C][]>(() => store.peek(name));
  useEffect(() => store.subscribe(name, setRows), [store, name]);
  return useMemo(() => {
    if (name !== "items" || !preview || !preview.showNew) return rows;
    const patches = preview.patches;
    return (rows as Item[]).map((r) => (patches[r.id] ? { ...r, ...patches[r.id] } : r)) as CollectionMap[C][];
  }, [rows, name, preview]);
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
