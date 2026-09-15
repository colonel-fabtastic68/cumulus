"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ChartChipRow {
  key: string;
  /** Series name, shown after the value. */
  label: ReactNode;
  /** The formatted value; it leads the row. */
  value: ReactNode;
  color: string;
  /** Draw the key dashed, for reference or projected series. */
  dashed?: boolean;
}

/**
 * The hover readout every chart shares: a small chip centred above the hovered
 * mark. `x` and `y` are percentages of the positioned parent for the point it
 * sits over; near either edge it shifts inward so it stays on the card. Values
 * lead and series names follow; each row is keyed by a short stroke of the
 * series colour.
 */
export function ChartChip({ x, y, title, rows, className }: { x: number; y: number; title: ReactNode; rows: ChartChipRow[]; className?: string }) {
  const shift = x < 22 ? "-14px" : x > 78 ? "calc(-100% + 14px)" : "-50%";
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute z-20 whitespace-nowrap rounded-[8px] border border-border bg-surface px-2.5 py-1.5 text-[11.5px] leading-4 shadow-[var(--shadow-pop)]", className)}
      style={{ left: `${x}%`, top: `${y}%`, transform: `translate(${shift}, calc(-100% - 8px))` }}
    >
      <div className="mb-1 text-[11px] text-text-tertiary">{title}</div>
      <div className="flex flex-col gap-0.5">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 shrink-0 border-t-2" style={{ borderColor: r.color, borderTopStyle: r.dashed ? "dashed" : "solid" }} />
            <span className="tabular font-semibold text-text">{r.value}</span>
            <span className="text-text-secondary">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
