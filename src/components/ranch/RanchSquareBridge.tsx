"use client";

import { useEffect, useRef } from "react";
import { useCollection } from "@/lib/store/provider";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/api-client";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useRanchMode } from "./useRanchMode";

const DEBOUNCE_MS = 2500;

/**
 * While cumulusOS keeps the ranch counts, stock changed on the regular pages
 * (an adjustment, a count, a receipt) reaches Square shortly after: the lots
 * that moved are sent to the server, which sets Square's counts to match.
 * Changes the server made itself land here too; re-sending them is harmless
 * because the push only writes counts that differ.
 */
export function RanchSquareBridge() {
  const { mode: sessionMode } = useSession();
  const { mode, squareConnected } = useRanchMode();
  const lots = useCollection("lots");
  const user = useCurrentUser();
  const api = useApi();
  const previous = useRef<Map<string, number> | null>(null);
  const pending = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const active = sessionMode === "firestore" && squareConnected && mode === "cumulus" && canWrite(user);

  useEffect(() => {
    const snapshot = new Map(lots.map((l) => [l.id, l.qtyRemaining]));
    const before = previous.current;
    previous.current = snapshot;
    if (!active || !before) return;
    for (const [id, qty] of snapshot) if (before.get(id) !== qty) pending.current.add(id);
    if (pending.current.size === 0) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const lotIds = Array.from(pending.current);
      pending.current.clear();
      api("/api/ranch/square-push", { lotIds }).catch(() => {
        // Sync now and the daily pass set every count, so a missed push is caught up.
      });
    }, DEBOUNCE_MS);
  }, [lots, active, api]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return null;
}
