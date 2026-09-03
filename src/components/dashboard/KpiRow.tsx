"use client";

import { AlertTriangle, Boxes, RotateCcw, ShoppingCart, Truck, Wallet } from "lucide-react";
import type { Rma, SalesOrder } from "@/lib/types";
import { formatMoney, formatNumber, pluralize } from "@/lib/format";
import { sum } from "@/lib/utils";
import { Stat } from "@/components/ui";
import { orderUnits, rmaUnits, type ShippedWindow } from "./dashboardData";

interface KpiRowProps {
  value: number;
  currency: string;
  activeCount: number;
  assemblyCount: number;
  lowCount: number;
  openOrders: SalesOrder[];
  openRmas: Rma[];
  shipped: ShippedWindow;
}

export function KpiRow({ value, currency, activeCount, assemblyCount, lowCount, openOrders, openRmas, shipped }: KpiRowProps) {
  const unitsToShip = sum(openOrders.map(orderUnits));
  const unitsReturning = sum(openRmas.map(rmaUnits));

  let shippedHint: React.ReactNode;
  if (shipped.changePct === null) {
    shippedHint = shipped.prior === 0 && shipped.current === 0 ? "No sales in the last 60 days" : "No sales in the prior 30 days";
  } else if (shipped.changePct === 0) {
    shippedHint = "Level with the prior 30 days";
  } else {
    const up = shipped.changePct > 0;
    shippedHint = (
      <span>
        <span className={up ? "font-medium text-success" : "font-medium text-critical"}>
          {up ? "+" : "−"}
          {Math.abs(shipped.changePct)}%
        </span>{" "}
        vs prior 30 days
      </span>
    );
  }

  return (
    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <Stat label="Inventory value" value={formatMoney(value, currency)} hint="At standard cost" icon={<Wallet />} />
      <Stat label="Active SKUs" value={formatNumber(activeCount)} hint={`${pluralize(assemblyCount, "assembly", "assemblies")}`} icon={<Boxes />} href="/inventory" />
      <Stat
        label="Below minimum"
        value={formatNumber(lowCount)}
        tone={lowCount > 0 ? "warning" : "default"}
        hint={lowCount > 0 ? "Needs reordering" : "All stocked up"}
        icon={<AlertTriangle />}
        href="/inventory?filter=low"
      />
      <Stat label="Open orders" value={formatNumber(openOrders.length)} hint={`${pluralize(unitsToShip, "unit")} to ship`} icon={<ShoppingCart />} href="/orders" />
      <Stat label="Open returns" value={formatNumber(openRmas.length)} hint={`${pluralize(unitsReturning, "unit")} coming back`} icon={<RotateCcw />} href="/rmas" />
      <Stat label="Shipped, last 30 days" value={formatNumber(shipped.current)} hint={shippedHint} icon={<Truck />} />
    </div>
  );
}
