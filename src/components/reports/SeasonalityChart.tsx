"use client";

import { formatNumber } from "@/lib/format";

export interface SeasonalityPoint {
  /** YYYY-MM */
  month: string;
  sold: number;
  consumed: number;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const SOLD_COLOR = "var(--accent)";
export const CONSUMED_COLOR = "var(--warning)";

/** "2026-03" -> "Mar 2026" */
export function monthLabel(key: string, opts: { short?: boolean } = {}): string {
  const [y, m] = key.split("-");
  const name = MONTHS[Number(m) - 1] ?? key;
  return opts.short ? name : `${name} ${y}`;
}

/** Round the top of the axis up to a friendly tick step so gridlines land on round numbers. */
function niceScale(max: number, tickCount = 4): { top: number; step: number } {
  if (max <= 0) return { top: tickCount, step: 1 };
  const raw = max / tickCount;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalised = raw / magnitude;
  const step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;
  return { top: Math.ceil(max / step) * step, step };
}

const W = 760;
const H = 250;
const PAD = { top: 12, right: 12, bottom: 30, left: 46 };

/** Grouped bar chart drawn with inline SVG so it inherits theme colours from CSS variables. */
export function SeasonalityChart({ data, label }: { data: SeasonalityPoint[]; label: string }) {
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const max = Math.max(0, ...data.map((d) => Math.max(d.sold, d.consumed)));
  const { top, step } = niceScale(max);
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);

  const groupW = plotW / Math.max(1, data.length);
  const barW = Math.max(4, Math.min(28, groupW * 0.32));
  const gap = 3;
  const y = (v: number) => PAD.top + plotH - (top > 0 ? (v / top) * plotH : 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="block h-auto w-full select-none text-[11px]">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--border-strong)" : "var(--border)"} strokeWidth={1} />
          <text x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fill="var(--text-tertiary)">
            {formatNumber(t)}
          </text>
        </g>
      ))}

      {data.map((d, i) => {
        const cx = PAD.left + groupW * i + groupW / 2;
        const soldX = cx - barW - gap / 2;
        const consX = cx + gap / 2;
        const short = monthLabel(d.month, { short: true });
        const showYear = i === 0 || d.month.endsWith("-01");
        const full = monthLabel(d.month);
        return (
          <g key={d.month}>
            <rect x={soldX} y={y(d.sold)} width={barW} height={Math.max(0, y(0) - y(d.sold))} rx={2} fill={SOLD_COLOR}>
              <title>{`${full} · Sold ${formatNumber(d.sold, 2)}`}</title>
            </rect>
            <rect x={consX} y={y(d.consumed)} width={barW} height={Math.max(0, y(0) - y(d.consumed))} rx={2} fill={CONSUMED_COLOR}>
              <title>{`${full} · Consumed in builds ${formatNumber(d.consumed, 2)}`}</title>
            </rect>
            <text x={cx} y={H - PAD.bottom + 14} textAnchor="middle" fill="var(--text-secondary)">
              {short}
            </text>
            {showYear && (
              <text x={cx} y={H - PAD.bottom + 26} textAnchor="middle" fill="var(--text-tertiary)" fontSize={10}>
                {d.month.slice(0, 4)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function ChartLegend() {
  return (
    <div className="flex items-center gap-4 text-[12px] text-text-secondary">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: SOLD_COLOR }} /> Sold
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: CONSUMED_COLOR }} /> Consumed in builds
      </span>
    </div>
  );
}
