"use client";

import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { cn, sum } from "@/lib/utils";
import { Card, ChartChip } from "@/components/ui";
import { niceCeil, type WeekBucket } from "./dashboardData";
import { CardTitle } from "./CardTitle";

const GRID = [1, 0.75, 0.5, 0.25, 0];

/**
 * Inline SVG grouped bar chart. Bars live in a stretched SVG so they stay
 * responsive; axis text is plain HTML so it never distorts.
 */
export function ShippedVsBuiltChart({ weeks }: { weeks: WeekBucket[] }) {
  const { max, totalShipped, totalBuilt } = useMemo(() => {
    const peak = Math.max(0, ...weeks.flatMap((w) => [w.shipped, w.built]));
    return { max: niceCeil(peak), totalShipped: sum(weeks.map((w) => w.shipped)), totalBuilt: sum(weeks.map((w) => w.built)) };
  }, [weeks]);

  const n = Math.max(1, weeks.length);
  const slot = 100 / n;
  const barW = slot * 0.3;
  const gap = slot * 0.06;
  const inset = (slot - (barW * 2 + gap)) / 2;
  const [hover, setHover] = useState<number | null>(null);
  const hovered = hover !== null ? weeks[hover] : undefined;

  return (
    <Card>
      <CardTitle
        icon={<BarChart3 />}
        title="Shipped vs built"
        meta={<span className="hidden text-[12.5px] text-text-tertiary sm:inline">last 12 weeks</span>}
        action={
          <div className="flex items-center gap-3 text-[12px] text-text-secondary">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--accent)" }} />
              Shipped <span className="tabular text-text-tertiary">{formatNumber(totalShipped)}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: "var(--success)" }} />
              Built <span className="tabular text-text-tertiary">{formatNumber(totalBuilt)}</span>
            </span>
          </div>
        }
      />
      <div className="mt-4 flex gap-2">
        <div className="relative w-9 shrink-0 text-[11px] text-text-tertiary tabular">
          {GRID.map((f) => (
            <span key={f} className="absolute right-0 -translate-y-1/2 leading-none" style={{ top: `${(1 - f) * 100}%` }}>
              {formatNumber(max * f)}
            </span>
          ))}
        </div>
        <div className="relative h-44 min-w-0 flex-1">
          {GRID.map((f) => (
            <div key={f} className={cn("absolute inset-x-0 border-t", f === 0 ? "border-border-strong/70" : "border-border")} style={{ top: `${(1 - f) * 100}%` }} />
          ))}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img" aria-label="Units shipped and built per week" onPointerLeave={() => setHover(null)}>
            {weeks.map((w, i) => {
              const x0 = i * slot + inset;
              const hS = max > 0 ? (w.shipped / max) * 100 : 0;
              const hB = max > 0 ? (w.built / max) * 100 : 0;
              return (
                <g key={w.key} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} opacity={hover !== null && hover !== i ? 0.45 : 1}>
                  <rect x={i * slot} y={0} width={slot} height={100} fill="transparent" tabIndex={0} role="img" aria-label={`Week of ${w.label}: ${formatNumber(w.shipped)} shipped, ${formatNumber(w.built)} built`} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
                  {hS > 0 && <rect x={x0} y={100 - hS} width={barW} height={hS} fill="var(--accent)" className="pointer-events-none" />}
                  {hB > 0 && <rect x={x0 + barW + gap} y={100 - hB} width={barW} height={hB} fill="var(--success)" className="pointer-events-none" />}
                </g>
              );
            })}
          </svg>
          {hovered && (
            <ChartChip
              x={hover! * slot + slot / 2}
              y={100 - (max > 0 ? (Math.max(hovered.shipped, hovered.built) / max) * 100 : 0)}
              title={`Week of ${hovered.label}`}
              rows={[
                { key: "shipped", color: "var(--accent)", value: formatNumber(hovered.shipped), label: "shipped" },
                { key: "built", color: "var(--success)", value: formatNumber(hovered.built), label: "built" },
              ]}
            />
          )}
        </div>
      </div>
      <div className="mt-2 flex pl-11 text-[11px] text-text-tertiary">
        {weeks.map((w, i) => (
          <span key={w.key} className={cn("min-w-0 flex-1 truncate text-center", i % 2 === 1 && "invisible sm:visible")} title={`ISO week ${w.isoWeek}`}>
            {w.label}
          </span>
        ))}
      </div>
      {totalShipped === 0 && totalBuilt === 0 && <p className="mt-3 text-center text-[12.5px] text-text-tertiary">No sales or builds recorded in the last 12 weeks.</p>}
    </Card>
  );
}
