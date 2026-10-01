"use client";

import { useMemo } from "react";
import { useCollection, useItems, useSettings } from "@/lib/store/provider";
import { replenishmentPlan, type ReplenishmentRow } from "@/lib/replenishment";

/** The live replenishment plan: every item with a low line, with its forecast and what to order. */
export function useReplenishmentPlan(): ReplenishmentRow[] {
  const items = useItems();
  const suppliers = useCollection("suppliers");
  const purchaseOrders = useCollection("purchaseOrders");
  const orders = useCollection("orders");
  const movements = useCollection("movements");
  const settings = useSettings();
  return useMemo(() => replenishmentPlan({ items, suppliers, purchaseOrders, orders, movements, rule: settings.stockAlerts }), [items, suppliers, purchaseOrders, orders, movements, settings.stockAlerts]);
}
