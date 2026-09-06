"use client";

import { useMemo } from "react";
import { DollarSign, PackageCheck, ShoppingCart } from "lucide-react";
import type { SalesOrder } from "@/lib/types";
import { useSettings } from "@/lib/store/provider";
import { formatMoney, formatNumber, pluralize } from "@/lib/format";
import { sum } from "@/lib/utils";
import { Stat } from "@/components/ui";
import { orderTotal, orderUnits, withinDays } from "./orderUtils";

const WINDOW_DAYS = 30;

function computeStats(orders: SalesOrder[]) {
  const open = orders.filter((o) => o.status === "open");
  const shipped = orders.filter((o) => o.status === "fulfilled" && withinDays(o.fulfilledAt, WINDOW_DAYS));
  return {
    open: open.length,
    unitsToShip: sum(open.map(orderUnits)),
    revenue: sum(shipped.map(orderTotal)),
    shippedOrders: shipped.length,
    shippedUnits: sum(shipped.map(orderUnits)),
  };
}

export function OrderStats({ orders }: { orders: SalesOrder[] }) {
  const { currency } = useSettings();
  const stats = useMemo(() => computeStats(orders), [orders]);
  return (
    <div className="grid grid-cols-1 gap-3 @md:grid-cols-3">
      <Stat label="Open orders" value={formatNumber(stats.open)} hint={stats.open ? `${pluralize(stats.unitsToShip, "unit")} waiting to ship` : "Nothing waiting to ship"} tone={stats.open > 0 ? "warning" : "default"} icon={<ShoppingCart />} />
      <Stat label="Revenue" value={formatMoney(stats.revenue, currency)} hint={`Last ${WINDOW_DAYS} days · ${pluralize(stats.shippedOrders, "fulfilled order")}`} tone={stats.revenue > 0 ? "success" : "default"} icon={<DollarSign />} />
      <Stat label="Units shipped" value={formatNumber(stats.shippedUnits)} hint={`Last ${WINDOW_DAYS} days`} icon={<PackageCheck />} />
    </div>
  );
}
