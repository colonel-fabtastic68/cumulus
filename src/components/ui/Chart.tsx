"use client";

import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ChartChip, type ChartChipRow } from "./ChartChip";

/**
 * Small SVG charts in the app's own tokens: one y-axis, thin marks, recessive
 * grid, a hover crosshair with a tooltip, direct labels through the legend.
 * Time goes on the x-axis as ISO dates; the projected part of a series is
 * drawn dashed and shaded so the reader sees where history stops.
 */

export interface ChartSeries {
  key: string;
  label: string;
  /** CSS colour (a token works: "var(--accent)"). */
  color: string;
  /** Values by x index; null leaves a gap. */
  values: Array<number | null>;
  /** Index from which the series is a projection (dashed). */
  projectedFrom?: number;
  /** Fill the area under the line. */
  area?: boolean;
  /** A flat reference line, e.g. the minimum. */
  reference?: boolean;
}

export interface LineChartProps {
  /** x labels (ISO dates or plain strings), one per index. */
  x: string[];
  series: ChartSeries[];
  height?: number;
  format?: (v: number) => string;
  formatX?: (x: string) => string;
  /** Vertical markers, e.g. "today" or an expected stockout. */
  markers?: Array<{ index: number; label: string; tone?: "default" | "critical" | "warning" }>;
  emptyText?: string;
  className?: string;
}

const PAD = { top: 12, right: 12, bottom: 26, left: 44 };

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const span = max - min;
  const rough = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

export function LineChart({ x, series, height = 240, format = (v) => String(Math.round(v)), formatX = (v) => v, markers = [], emptyText = "Nothing to plot yet", className }: LineChartProps) {
  const id = useId();
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const n = x.length;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  const { min, max, ticks } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) for (const v of s.values) if (v !== null && Number.isFinite(v)) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!Number.isFinite(lo)) return { min: 0, max: 1, ticks: [0, 1] };
    if (lo > 0) lo = 0;
    if (hi === lo) hi = lo + 1;
    const t = niceTicks(lo, hi);
    return { min: Math.min(lo, t[0] ?? lo), max: Math.max(hi, t[t.length - 1] ?? hi), ticks: t };
  }, [series]);

  const sx = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const sy = (v: number) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;
  const hasData = series.some((s) => s.values.some((v) => v !== null));

  const path = (s: ChartSeries, from: number, to: number) => {
    let d = "";
    let open = false;
    for (let i = from; i <= to; i++) {
      const v = s.values[i];
      if (v === null || v === undefined) { open = false; continue; }
      d += `${open ? "L" : "M"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`;
      open = true;
    }
    return d;
  };
  const areaPath = (s: ChartSeries, from: number, to: number) => {
    const pts: Array<[number, number]> = [];
    for (let i = from; i <= to; i++) { const v = s.values[i]; if (v !== null && v !== undefined) pts.push([sx(i), sy(v)]); }
    if (pts.length < 2) return "";
    const base = sy(Math.max(min, 0));
    return `M${pts[0]![0]},${base}` + pts.map(([px, py]) => `L${px.toFixed(1)},${py.toFixed(1)}`).join("") + `L${pts[pts.length - 1]![0]},${base}Z`;
  };

  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || n === 0) return;
    const px = ((e.clientX - rect.left) / rect.width) * width;
    const i = Math.round(((px - PAD.left) / plotW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const onKey = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (n === 0) return;
    if (e.key === "Escape") setHover(null);
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const step = e.key === "ArrowRight" ? 1 : -1;
    setHover((h) => Math.max(0, Math.min(n - 1, (h ?? (step > 0 ? -1 : n)) + step)));
  };

  const xTicks = useMemo(() => {
    if (n === 0) return [] as number[];
    const count = Math.min(6, n);
    const out: number[] = [];
    for (let k = 0; k < count; k++) out.push(Math.round((k / Math.max(1, count - 1)) * (n - 1)));
    return Array.from(new Set(out));
  }, [n]);

  let lineChip: { x: number; y: number; rows: ChartChipRow[] } | null = null;
  if (hover !== null && hasData) {
    const rows: ChartChipRow[] = [];
    let top = PAD.top + plotH;
    for (const s of series) {
      const v = s.values[hover];
      if (v === null || v === undefined) continue;
      top = Math.min(top, sy(v));
      rows.push({ key: s.key, color: s.color, dashed: s.reference, value: format(v), label: `${s.label}${(s.projectedFrom ?? n) <= hover ? " (projected)" : ""}` });
    }
    if (rows.length) lineChip = { x: (sx(hover) / width) * 100, y: (top / height) * 100, rows };
  }

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full select-none" role="img" aria-label={series.map((s) => s.label).join(", ")} tabIndex={hasData ? 0 : undefined} onPointerMove={onPointer} onPointerDown={onPointer} onPointerLeave={() => setHover(null)} onKeyDown={onKey} onFocus={() => setHover((h) => h ?? n - 1)} onBlur={() => setHover(null)}>
        <defs>
          <clipPath id={`${id}-clip`}>
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
          </clipPath>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={sy(t)} y2={sy(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.left - 6} y={sy(t) + 3.5} textAnchor="end" fontSize={10.5} fill="var(--text-tertiary)">
              {format(t)}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} x={sx(i)} y={height - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize={10.5} fill="var(--text-tertiary)">
            {formatX(x[i]!)}
          </text>
        ))}
        {!hasData && (
          <text x={width / 2} y={height / 2} textAnchor="middle" fontSize={12} fill="var(--text-tertiary)">
            {emptyText}
          </text>
        )}
        <g clipPath={`url(#${id}-clip)`}>
          {series.map((s) => {
            const split = s.projectedFrom ?? n;
            const histEnd = Math.min(n - 1, Math.max(0, split));
            return (
              <g key={s.key}>
                {s.area && <path d={areaPath(s, 0, histEnd)} fill={s.color} opacity={0.1} />}
                {s.area && split < n && <path d={areaPath(s, Math.max(0, split - 1), n - 1)} fill={s.color} opacity={0.05} />}
                <path d={path(s, 0, histEnd)} fill="none" stroke={s.color} strokeWidth={s.reference ? 1.25 : 2} strokeDasharray={s.reference ? "4 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />
                {split < n && <path d={path(s, Math.max(0, split - 1), n - 1)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />}
              </g>
            );
          })}
          {markers.map((m) => (
            <g key={`${m.index}-${m.label}`}>
              <line x1={sx(m.index)} x2={sx(m.index)} y1={PAD.top} y2={PAD.top + plotH} stroke={m.tone === "critical" ? "var(--critical)" : m.tone === "warning" ? "var(--warning)" : "var(--text-tertiary)"} strokeWidth={1} strokeDasharray="2 3" />
              <text x={sx(m.index) + 4} y={PAD.top + 10} fontSize={10} fill={m.tone === "critical" ? "var(--critical)" : m.tone === "warning" ? "var(--warning)" : "var(--text-tertiary)"}>
                {m.label}
              </text>
            </g>
          ))}
          {hover !== null && hasData && (
            <g>
              <line x1={sx(hover)} x2={sx(hover)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--text-tertiary)" strokeWidth={1} />
              {series.map((s) => {
                const v = s.values[hover];
                return v === null || v === undefined ? null : <circle key={s.key} cx={sx(hover)} cy={sy(v)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />;
              })}
            </g>
          )}
        </g>
      </svg>
      {lineChip && <ChartChip x={lineChip.x} y={lineChip.y} title={formatX(x[hover!]!)} rows={lineChip.rows} />}
      </div>
      <Legend series={series} />
    </div>
  );
}

function Legend({ series }: { series: ChartSeries[] }) {
  if (series.length < 2) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[11.5px] text-text-secondary">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: s.color, opacity: s.reference ? 0.7 : 1 }} />
          {s.label}
          {s.projectedFrom !== undefined && s.projectedFrom < s.values.length ? <span className="text-text-tertiary">(dashed = projected)</span> : null}
        </span>
      ))}
    </div>
  );
}

export interface BarChartProps {
  x: string[];
  series: ChartSeries[];
  height?: number;
  format?: (v: number) => string;
  formatX?: (x: string) => string;
  className?: string;
  emptyText?: string;
}

/** Grouped bars with the same axis conventions as LineChart; projected bars are outlined. */
export function BarChart({ x, series, height = 220, format = (v) => String(Math.round(v)), formatX = (v) => v, className, emptyText = "Nothing to plot yet" }: BarChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 720;
  const n = x.length;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const max = useMemo(() => {
    let hi = 0;
    for (const s of series) for (const v of s.values) if (v !== null && v > hi) hi = v;
    return hi || 1;
  }, [series]);
  const ticks = niceTicks(0, max);
  const top = Math.max(max, ticks[ticks.length - 1] ?? max);
  const sy = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const slot = n ? plotW / n : plotW;
  const barW = Math.max(2, (slot * 0.7) / Math.max(1, series.length));
  const hasData = series.some((s) => s.values.some((v) => v !== null && v !== 0));
  const label = (i: number) => (n > 14 && i % Math.ceil(n / 12) !== 0 ? null : formatX(x[i]!));

  let barChip: { x: number; y: number; rows: ChartChipRow[] } | null = null;
  if (hover !== null && hasData) {
    const rows: ChartChipRow[] = [];
    let peak = 0;
    for (const s of series) {
      const v = s.values[hover];
      if (v === null || v === undefined) continue;
      peak = Math.max(peak, v);
      rows.push({ key: s.key, color: s.color, value: format(v), label: `${s.label}${(s.projectedFrom ?? n) <= hover ? " (projected)" : ""}` });
    }
    if (rows.length) barChip = { x: ((PAD.left + hover * slot + slot / 2) / width) * 100, y: (sy(peak) / height) * 100, rows };
  }
  const groupLabel = (i: number) => `${formatX(x[i]!)}: ${series.map((s) => `${s.label} ${s.values[i] === null || s.values[i] === undefined ? "no data" : format(s.values[i]!)}`).join(", ")}`;

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full select-none" role="img" aria-label={series.map((s) => s.label).join(", ")} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={sy(t)} y2={sy(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={PAD.left - 6} y={sy(t) + 3.5} textAnchor="end" fontSize={10.5} fill="var(--text-tertiary)">
              {format(t)}
            </text>
          </g>
        ))}
        {!hasData && (
          <text x={width / 2} y={height / 2} textAnchor="middle" fontSize={12} fill="var(--text-tertiary)">
            {emptyText}
          </text>
        )}
        {x.map((_, i) => (
          <g key={i} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
            <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill={hover === i ? "var(--surface-hover)" : "transparent"} tabIndex={hasData ? 0 : undefined} role="img" aria-label={groupLabel(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
            {series.map((s, k) => {
              const v = s.values[i];
              if (v === null || v === undefined) return null;
              const projected = (s.projectedFrom ?? n) <= i;
              const bx = PAD.left + i * slot + (slot - barW * series.length) / 2 + k * barW;
              const by = sy(Math.max(0, v));
              const h = Math.max(0, sy(0) - by);
              return <rect key={s.key} x={bx + 1} y={by} width={Math.max(1, barW - 2)} height={h} rx={2} fill={projected ? "var(--surface)" : s.color} stroke={s.color} strokeWidth={projected ? 1.5 : 0} strokeDasharray={projected ? "3 2" : undefined} opacity={hover !== null && hover !== i ? 0.45 : 1} className="pointer-events-none" />;
            })}
            {label(i) && (
              <text x={PAD.left + i * slot + slot / 2} y={height - 8} textAnchor="middle" fontSize={10.5} fill="var(--text-tertiary)">
                {label(i)}
              </text>
            )}
          </g>
        ))}
      </svg>
      {barChip && <ChartChip x={barChip.x} y={barChip.y} title={formatX(x[hover!]!)} rows={barChip.rows} />}
      </div>
      <Legend series={series} />
    </div>
  );
}

export function ChartCard({ title, description, action, children }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[13.5px] font-semibold text-text">{title}</h3>
          {description && <p className="mt-0.5 text-[12px] text-text-secondary">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
