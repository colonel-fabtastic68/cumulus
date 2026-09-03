"use client";

import { useMemo } from "react";
import type { ActivityEvent, Member } from "@/lib/types";
import { inventoryValue, lowStockReport } from "@/lib/inventory";
import { useCollection, useItems, useItemsById, useSettings } from "@/lib/store/provider";
import { agentSuggestions, isOpenOrder, isOpenRma, shippedUnits, weeklyShippedVsBuilt } from "./dashboardData";

/** Everything the home dashboard renders, derived once from the live collections. */
export function useDashboardData() {
  const items = useItems();
  const itemsById = useItemsById();
  const movements = useCollection("movements");
  const suppliers = useCollection("suppliers");
  const orders = useCollection("orders");
  const rmas = useCollection("rmas");
  const lots = useCollection("lots");
  const members = useCollection("members");
  const activity = useCollection("activity");
  const settings = useSettings();

  const activeCount = useMemo(() => items.filter((i) => i.status === "active").length, [items]);
  const assemblyCount = useMemo(() => items.filter((i) => i.status === "active" && i.type === "assembly").length, [items]);
  const value = useMemo(() => inventoryValue(items), [items]);
  const lowRows = useMemo(() => lowStockReport(items, suppliers, movements), [items, suppliers, movements]);
  const openOrders = useMemo(() => orders.filter(isOpenOrder).sort((a, b) => a.createdAt.localeCompare(b.createdAt)), [orders]);
  const openRmas = useMemo(() => rmas.filter(isOpenRma).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [rmas]);
  const shipped = useMemo(() => shippedUnits(movements, 30), [movements]);
  const weeks = useMemo(() => weeklyShippedVsBuilt(movements, 12), [movements]);
  const suggestions = useMemo(
    () => agentSuggestions({ items, movements, lots, openOrders, lowCount: lowRows.length, settings }),
    [items, movements, lots, openOrders, lowRows.length, settings],
  );
  const recentActivity = useMemo<ActivityEvent[]>(() => [...activity].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10), [activity]);
  const membersById = useMemo(() => new Map<string, Member>(members.map((m) => [m.id, m])), [members]);

  return {
    items,
    itemsById,
    settings,
    currency: settings.currency,
    activeCount,
    assemblyCount,
    value,
    lowRows,
    openOrders,
    openRmas,
    shipped,
    weeks,
    suggestions,
    recentActivity,
    members,
    membersById,
  };
}

export type DashboardData = ReturnType<typeof useDashboardData>;
