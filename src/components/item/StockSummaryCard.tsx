"use client";

import { useMemo } from "react";
import type { Item, Lot, StockMovement, WorkspaceSettings } from "@/lib/types";
import { consumptionRate, isLowStock, reorderQty } from "@/lib/inventory";
import { formatMoney, formatNumber, formatQty } from "@/lib/format";
import { cn, round } from "@/lib/utils";
import { Card } from "@/components/ui";
import { Tile } from "./Tile";
import { weightedAverageCost } from "./utils";

export function StockSummaryCard({ item, movements, lots, settings }: { item: Item; movements: StockMovement[]; lots: Lot[]; settings: WorkspaceSettings }) {
  const currency = settings.currency;
  const low = isLowStock(item);
  const reorder = reorderQty(item);

  const rate = useMemo(() => consumptionRate(movements, 90).get(item.id) ?? 0, [movements, item.id]);
  const daysOfCover = rate > 0 ? Math.floor(item.onHand / rate) : null;
  const avg = useMemo(() => weightedAverageCost(lots, item.unitCost), [lots, item.unitCost]);
  const value = round(item.onHand * item.unitCost);

  const ceiling = item.maxQty ?? (item.minQty !== undefined ? item.minQty * 2 : undefined);
  const pct = ceiling && ceiling > 0 ? Math.min(100, Math.max(0, (item.onHand / ceiling) * 100)) : null;
  const minPct = ceiling && item.minQty !== undefined ? Math.min(100, (item.minQty / ceiling) * 100) : null;
  const overMax = item.maxQty !== undefined && item.onHand > item.maxQty;
  const barTone = low ? "bg-critical" : overMax ? "bg-warning" : "bg-success";

  const coverTone = daysOfCover === null ? "default" : daysOfCover < (item.leadTimeDays ?? 14) ? "critical" : daysOfCover < 30 ? "warning" : "default";

  return (
    <Card>
      <div className={cn("grid gap-x-6 gap-y-4", settings.trackInUse ? "grid-cols-2 @md:grid-cols-3 @3xl:grid-cols-6" : "grid-cols-2 @md:grid-cols-3 @3xl:grid-cols-5")}>
        <Tile label="On hand" value={formatQty(item.onHand, item.unit)} hint={item.location ? `Location ${item.location}` : undefined} tone={low ? "critical" : "default"} />
        {settings.trackInUse && <Tile label="In use" value={formatQty(item.inUse, item.unit)} hint="Checked out to jobs" />}
        <Tile
          label="Reorder qty"
          value={reorder > 0 ? formatQty(reorder, item.unit) : "—"}
          hint={item.maxQty !== undefined ? `Brings stock to max ${formatNumber(item.maxQty)}` : item.minQty !== undefined ? `Brings stock to 2× min` : "No min/max set"}
          tone={low ? "warning" : "default"}
        />
        <Tile
          label="Days of cover"
          value={daysOfCover === null ? "—" : formatNumber(daysOfCover)}
          hint={rate > 0 ? `${formatQty(round(rate * 7, 2), item.unit)} / week, last 90 days` : "No consumption in 90 days"}
          tone={coverTone}
        />
        <Tile label="Inventory value" value={formatMoney(value, currency)} hint={`at ${formatMoney(item.unitCost, currency)} standard cost`} />
        <Tile
          label="Avg unit cost"
          value={formatMoney(avg.cost, currency)}
          hint={avg.fromLots ? "Weighted across batches on shelf" : "No batches on shelf; standard cost"}
        />
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[12px] text-text-secondary">
          <span>
            Min <span className="font-medium text-text tabular">{item.minQty !== undefined ? formatQty(item.minQty, item.unit) : "—"}</span>
            <span className="mx-1.5 text-text-tertiary">·</span>
            Max <span className="font-medium text-text tabular">{item.maxQty !== undefined ? formatQty(item.maxQty, item.unit) : "—"}</span>
          </span>
          <span className={cn(low ? "text-critical" : overMax ? "text-warning" : "text-text-tertiary")}>
            {low ? `${formatQty(round((item.minQty ?? 0) - item.onHand, 3), item.unit)} below minimum` : overMax ? `${formatQty(round(item.onHand - (item.maxQty ?? 0), 3), item.unit)} above maximum` : pct !== null ? `${Math.round(pct)}% of ${item.maxQty !== undefined ? "max" : "2× min"}` : "No thresholds set"}
          </span>
        </div>
        <div className="relative h-2 w-full overflow-hidden rounded-full bg-surface-hover" role="progressbar" aria-valuenow={pct ?? 0} aria-valuemin={0} aria-valuemax={100}>
          {pct !== null && <div className={cn("h-full rounded-full transition-[width]", barTone)} style={{ width: `${pct}%` }} />}
          {minPct !== null && <div className="absolute top-0 h-full w-px bg-text/60" style={{ left: `${minPct}%` }} title={`Min ${formatQty(item.minQty ?? 0, item.unit)}`} />}
        </div>
      </div>
    </Card>
  );
}
