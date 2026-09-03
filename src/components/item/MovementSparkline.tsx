"use client";

import { useMemo } from "react";
import type { StockMovement } from "@/lib/types";
import { formatQty } from "@/lib/format";
import { round } from "@/lib/utils";
import { weeklyBuckets } from "./utils";

const W = 560;
const H = 120;
const PAD_X = 4;
const MID = H / 2;
const MAX_BAR = MID - 10;

/**
 * Twelve-week in vs out chart as inline SVG. Inbound units draw upward from
 * the baseline in green, outbound draw downward in blue, and a thin line
 * traces the weekly net.
 */
export function MovementSparkline({ movements, unit, weeks = 12 }: { movements: StockMovement[]; unit?: string; weeks?: number }) {
  const buckets = useMemo(() => weeklyBuckets(movements, weeks), [movements, weeks]);
  const totals = useMemo(() => {
    const inQty = round(buckets.reduce((a, b) => a + b.inQty, 0), 3);
    const outQty = round(buckets.reduce((a, b) => a + b.outQty, 0), 3);
    return { inQty, outQty, net: round(inQty - outQty, 3) };
  }, [buckets]);

  const peak = Math.max(1, ...buckets.map((b) => Math.max(b.inQty, b.outQty)));
  const slot = (W - PAD_X * 2) / buckets.length;
  const barW = Math.max(6, slot * 0.55);
  const scale = (v: number) => (v / peak) * MAX_BAR;
  const empty = totals.inQty === 0 && totals.outQty === 0;

  const netPath = buckets
    .map((b, i) => {
      const x = PAD_X + i * slot + slot / 2;
      const y = MID - ((b.inQty - b.outQty) / peak) * MAX_BAR;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
        <div className="flex items-center gap-3 text-text-secondary">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-success" /> In {formatQty(totals.inQty, unit)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-info" /> Out {formatQty(totals.outQty, unit)}
          </span>
        </div>
        <span className={totals.net > 0 ? "text-success" : totals.net < 0 ? "text-critical" : "text-text-tertiary"}>
          Net {totals.net > 0 ? "+" : ""}
          {formatQty(totals.net, unit)} over {weeks} weeks
        </span>
      </div>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-[120px] w-full" role="img" aria-label={`Weekly stock movement for the last ${weeks} weeks`}>
          <line x1={PAD_X} x2={W - PAD_X} y1={MID} y2={MID} stroke="var(--border-strong)" strokeWidth={1} />
          {buckets.map((b, i) => {
            const x = PAD_X + i * slot + (slot - barW) / 2;
            const hIn = scale(b.inQty);
            const hOut = scale(b.outQty);
            return (
              <g key={b.start}>
                <title>
                  {`Week of ${b.label}: +${formatQty(b.inQty, unit)} in, −${formatQty(b.outQty, unit)} out (net ${b.inQty - b.outQty >= 0 ? "+" : ""}${formatQty(round(b.inQty - b.outQty, 3), unit)})`}
                </title>
                <rect x={x} y={MID - hIn} width={barW} height={hIn} rx={2} fill="var(--success)" opacity={0.75} />
                <rect x={x} y={MID} width={barW} height={hOut} rx={2} fill="var(--info)" opacity={0.65} />
                <rect x={PAD_X + i * slot} y={0} width={slot} height={H} fill="transparent" />
              </g>
            );
          })}
          {!empty && <path d={netPath} fill="none" stroke="var(--text)" strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" opacity={0.6} />}
        </svg>
        {empty && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12.5px] text-text-tertiary">No movement in the last {weeks} weeks</div>}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-text-tertiary">
        <span>{buckets[0]?.label}</span>
        <span>{buckets[Math.floor(buckets.length / 2)]?.label}</span>
        <span>{buckets[buckets.length - 1]?.label}</span>
      </div>
    </div>
  );
}
