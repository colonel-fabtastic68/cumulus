"use client";

import { useMemo } from "react";
import { CircleDollarSign, PackageCheck, Truck } from "lucide-react";
import type { Receipt } from "@/lib/types";
import { useSettings } from "@/lib/store/provider";
import { formatMoney, formatNumber, pluralize } from "@/lib/format";
import { Stat } from "@/components/ui";
import { receiptTotal } from "./receiptUtils";

const DAY_MS = 86_400_000;

export function ReceivingStats({ receipts }: { receipts: Receipt[] }) {
  const { currency } = useSettings();

  const stats = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const since30 = now.getTime() - 30 * DAY_MS;
    const since90 = now.getTime() - 90 * DAY_MS;
    let thisMonth = 0;
    let value30 = 0;
    let count30 = 0;
    let count90 = 0;
    const suppliers90 = new Set<string>();
    for (const r of receipts) {
      const t = new Date(r.receivedAt).getTime();
      if (Number.isNaN(t)) continue;
      if (t >= monthStart) thisMonth++;
      if (t >= since30) {
        value30 += receiptTotal(r);
        count30++;
      }
      if (t >= since90) {
        count90++;
        if (r.supplierId) suppliers90.add(r.supplierId);
      }
    }
    return {
      thisMonth,
      monthLabel: now.toLocaleDateString("en-US", { month: "long" }),
      value30,
      count30,
      count90,
      suppliers90: suppliers90.size,
    };
  }, [receipts]);

  return (
    <div className="grid grid-cols-1 gap-3 @md:grid-cols-3">
      <Stat label="Receipts this month" value={formatNumber(stats.thisMonth)} hint={stats.monthLabel} icon={<PackageCheck />} />
      <Stat
        label="Value received"
        value={formatMoney(stats.value30, currency)}
        hint={`Last 30 days · ${pluralize(stats.count30, "receipt")}`}
        icon={<CircleDollarSign />}
      />
      <Stat
        label="Distinct suppliers"
        value={formatNumber(stats.suppliers90)}
        hint={`Last 90 days · ${pluralize(stats.count90, "receipt")}`}
        icon={<Truck />}
      />
    </div>
  );
}
