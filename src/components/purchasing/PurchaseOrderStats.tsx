"use client";

import { useMemo } from "react";
import { CalendarClock, ClipboardCheck, DollarSign } from "lucide-react";
import type { PurchaseOrder } from "@/lib/types";
import { useSettings } from "@/lib/store/provider";
import { formatMoney, formatNumber, pluralize } from "@/lib/format";
import { poDueWithin, poIsOpen, poIsOverdue, poLineOpenQty } from "@/lib/purchaseOrders";
import { sum } from "@/lib/utils";
import { Stat } from "@/components/ui";
import { poOpenValue } from "./poUtils";

export function PurchaseOrderStats({ purchaseOrders }: { purchaseOrders: PurchaseOrder[] }) {
  const { currency } = useSettings();
  const stats = useMemo(() => {
    const open = purchaseOrders.filter(poIsOpen);
    const overdue = open.filter((p) => poIsOverdue(p));
    const dueSoon = open.filter((p) => poDueWithin(p, 7));
    return { open: open.length, units: sum(open.flatMap((p) => p.lines.map(poLineOpenQty))), value: sum(open.map(poOpenValue)), overdue: overdue.length, dueSoon: dueSoon.length };
  }, [purchaseOrders]);
  return (
    <div className="grid grid-cols-1 gap-3 @md:grid-cols-3">
      <Stat label="Open purchase orders" value={formatNumber(stats.open)} hint={stats.open ? `${pluralize(stats.units, "unit")} still to arrive` : "Nothing on order"} icon={<ClipboardCheck />} />
      <Stat label="On order" value={formatMoney(stats.value, currency)} hint="Value of what is still due" icon={<DollarSign />} />
      <Stat label="Overdue" value={formatNumber(stats.overdue)} hint={stats.overdue ? "Past the expected date" : stats.dueSoon ? `${pluralize(stats.dueSoon, "order")} due this week` : "Nothing late"} tone={stats.overdue > 0 ? "warning" : "default"} icon={<CalendarClock />} />
    </div>
  );
}
