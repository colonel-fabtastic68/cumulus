"use client";

import { useEffect, useRef } from "react";
import { useCollection, useItems } from "@/lib/store/provider";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/api-client";

const DEBOUNCE_MS = 1200;

/**
 * Factor 40: when on-hand changes on an item linked to a channel that mirrors
 * stock, ask the server to push the new count. Debounced, and only in the
 * hosted mode where the server holds the channel credentials.
 */
export function StockPushBridge() {
  const { mode } = useSession();
  const items = useItems();
  const integrations = useCollection("integrations");
  const api = useApi();
  const previous = useRef<Map<string, number> | null>(null);
  const pending = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = mode === "firestore" && integrations.some((i) => (i.id === "shopify" || i.id === "woocommerce") && i.status === "connected" && (i.settings?.pushStock === true || i.settings?.pushProducts === true));

  useEffect(() => {
    const snapshot = new Map(items.map((i) => [i.id, i.onHand]));
    const before = previous.current;
    previous.current = snapshot;
    if (!active || !before) return;
    for (const item of items) {
      const was = before.get(item.id);
      // A changed count on a linked item, or an item that did not exist a moment ago (a new part to create in the store).
      if ((was !== undefined && was !== item.onHand && item.channels) || (was === undefined && !item.channels && item.status === "active")) pending.current.add(item.id);
    }
    if (pending.current.size === 0) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const ids = Array.from(pending.current);
      pending.current.clear();
      api("/api/integrations/push-stock", { itemIds: ids }).catch(() => {
        // The scheduled sync reconciles anything a push misses.
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
