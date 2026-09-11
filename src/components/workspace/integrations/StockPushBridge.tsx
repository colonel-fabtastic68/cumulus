"use client";

import { useEffect, useRef } from "react";
import { useCollection, useItems } from "@/lib/store/provider";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/api-client";

const DEBOUNCE_MS = 1200;

interface Seen {
  onHand: number;
  updatedAt: string;
  linked: boolean;
}

/**
 * Factor 40: keeps connected stores in step with what happens here. A stock
 * change, a new item, an edit or a deletion is noticed from the live item
 * list and, after a short pause, the server pushes the outbound half of the
 * sync for just those items (deletions are picked up from their tombstones).
 * Only in the hosted mode, where the server holds the store credentials.
 */
export function StockPushBridge() {
  const { mode } = useSession();
  const items = useItems();
  const integrations = useCollection("integrations");
  const api = useApi();
  const previous = useRef<Map<string, Seen> | null>(null);
  const pendingStock = useRef(new Set<string>());
  const pendingDetails = useRef(new Set<string>());
  const pendingDelete = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = mode === "firestore" && integrations.some((i) => (i.id === "shopify" || i.id === "woocommerce") && i.status === "connected");

  useEffect(() => {
    const snapshot = new Map<string, Seen>(items.map((i) => [i.id, { onHand: i.onHand, updatedAt: i.updatedAt, linked: !!i.channels }]));
    const before = previous.current;
    previous.current = snapshot;
    if (!active || !before) return;
    for (const item of items) {
      const was = before.get(item.id);
      if (!was) {
        if (!item.channels && item.status === "active") pendingStock.current.add(item.id); // new item → create in the store
        continue;
      }
      if (!item.channels) continue;
      if (was.onHand !== item.onHand) pendingStock.current.add(item.id);
      else if (was.updatedAt !== item.updatedAt) pendingDetails.current.add(item.id);
    }
    for (const [id, was] of before) if (was.linked && !snapshot.has(id)) pendingDelete.current = true;
    if (pendingStock.current.size === 0 && pendingDetails.current.size === 0 && !pendingDelete.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const itemIds = Array.from(pendingStock.current);
      const detailIds = Array.from(pendingDetails.current);
      pendingStock.current.clear();
      pendingDetails.current.clear();
      pendingDelete.current = false;
      api("/api/integrations/push-stock", { itemIds, detailIds }).catch(() => {
        // The scheduled pass reconciles anything a push misses.
      });
    }, DEBOUNCE_MS);
  }, [items, active, api]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return null;
}
