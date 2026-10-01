"use client";

import { useMemo } from "react";
import { AlarmClock, CircleDollarSign, PackageCheck, Wand2 } from "lucide-react";
import { useSettings } from "@/lib/store/provider";
import { replenishmentSummary, type ReplenishmentRow } from "@/lib/replenishment";
import { formatMoney, formatNumber, pluralize } from "@/lib/format";
import { Stat } from "@/components/ui";

export function ReplenishmentStats({ rows }: { rows: ReplenishmentRow[] }) {
  const { currency } = useSettings();
  const s = useMemo(() => replenishmentSummary(rows), [rows]);
  return (
    <div className="grid grid-cols-1 gap-3 @md:grid-cols-4">
      <Stat label="To order" value={formatNumber(s.toOrder)} hint={s.toOrder ? `${pluralize(s.suppliers, "supplier")}${s.builds ? ` · ${pluralize(s.builds, "assembly", "assemblies")} to build` : ""}` : "Forecast covers every item"} icon={<AlarmClock />} tone={s.late > 0 ? "warning" : "default"} />
      <Stat label="Estimated cost" value={formatMoney(s.estCost, currency)} hint="At each supplier's last price" icon={<CircleDollarSign />} />
      <Stat label="Covered by incoming" value={formatNumber(s.covered)} hint={s.covered ? "Below min, but on order already" : "Nothing waiting on a delivery"} icon={<PackageCheck />} />
      <Stat label="Automatic" value={formatNumber(s.auto)} hint={s.auto ? "Drafted daily without asking" : "Switch items to automatic from their menu"} icon={<Wand2 />} />
    </div>
  );
}
