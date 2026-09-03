"use client";

import { useMemo } from "react";
import { PackagePlus, RotateCcw, Trash2 } from "lucide-react";
import type { Rma, StockMovement } from "@/lib/types";
import { formatNumber } from "@/lib/format";
import { sum } from "@/lib/utils";
import { Stat } from "@/components/ui";

const WINDOW_DAYS = 90;
const DAY = 86_400_000;

function computeStats(rmas: Rma[], movements: StockMovement[]) {
  const cutoff = Date.now() - WINDOW_DAYS * DAY;
  const within = (iso?: string) => !!iso && new Date(iso).getTime() >= cutoff;
  const open = rmas.filter((r) => r.status === "open" || r.status === "inspecting").length;
  const restocked = sum(movements.filter((m) => m.type === "rma_return" && within(m.occurredAt)).map((m) => m.qty));
  const scrapped = sum(rmas.filter((r) => within(r.resolvedAt)).flatMap((r) => r.lines.filter((l) => l.disposition === "scrap").map((l) => l.qty)));
  return { open, restocked, scrapped };
}

export function RmaStats({ rmas, movements }: { rmas: Rma[]; movements: StockMovement[] }) {
  const stats = useMemo(() => computeStats(rmas, movements), [rmas, movements]);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Stat label="Open RMAs" value={formatNumber(stats.open)} hint="Awaiting inspection or a decision" tone={stats.open > 0 ? "warning" : "default"} icon={<RotateCcw />} />
      <Stat label="Units restocked" value={formatNumber(stats.restocked)} hint={`Last ${WINDOW_DAYS} days · back on the shelf`} tone={stats.restocked > 0 ? "success" : "default"} icon={<PackagePlus />} />
      <Stat label="Units scrapped" value={formatNumber(stats.scrapped)} hint={`Last ${WINDOW_DAYS} days · written off`} tone={stats.scrapped > 0 ? "critical" : "default"} icon={<Trash2 />} />
    </div>
  );
}
