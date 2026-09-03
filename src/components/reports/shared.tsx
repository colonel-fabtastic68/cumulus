"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Download, Sparkles } from "lucide-react";
import type { Item } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button, EmptyState } from "@/components/ui";
import { useAgent } from "@/components/agent/AgentProvider";

/** SKU rendered as a link to the item page. Stops propagation so it works inside clickable rows. */
export function SkuLink({ item, className }: { item: Item; className?: string }) {
  return (
    <Link href={"/inventory/" + item.id} onClick={(e) => e.stopPropagation()} className={cn("font-mono text-[12px] text-accent hover:underline", className)}>
      {item.sku}
    </Link>
  );
}

/** Title row above each report card: what the report shows, plus export / agent actions. */
export function ReportHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[14px] font-semibold text-text">{title}</h2>
        {description && <p className="mt-0.5 max-w-2xl text-[12.5px] text-text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function ExportCsvButton({ onExport, label = "Export CSV", disabled, size = "sm" }: { onExport: () => void; label?: string; disabled?: boolean; size?: "sm" | "md" }) {
  return (
    <Button size={size} variant="secondary" icon={<Download />} onClick={onExport} disabled={disabled}>
      {label}
    </Button>
  );
}

/** Opens the agent panel and sends the given prompt straight away. */
export function AskAgentButton({ prompt, label = "Ask agent", size = "sm", disabled }: { prompt: string; label?: string; size?: "sm" | "md"; disabled?: boolean }) {
  const { open } = useAgent();
  return (
    <Button size={size} variant="secondary" icon={<Sparkles />} onClick={() => open(prompt, { send: true })} disabled={disabled}>
      {label}
    </Button>
  );
}

/** Shared "last N days" choices for window selects. */
export const WINDOW_OPTIONS = [
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "180", label: "Last 180 days" },
  { value: "365", label: "Last 365 days" },
];

export function Dash() {
  return <span className="text-text-tertiary">—</span>;
}

/** Slim horizontal share bar drawn with a div. */
export function ShareBar({ pct, className }: { pct: number; className?: string }) {
  const w = Math.min(100, Math.max(0, pct));
  return (
    <div className={cn("flex items-center justify-end gap-2", className)}>
      <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-surface-hover">
        <div className="h-full rounded-full bg-accent" style={{ width: `${w}%` }} />
      </div>
      <span className="w-12 text-right tabular">{w.toFixed(1)}%</span>
    </div>
  );
}

/** Smaller heading for a secondary table inside a report (e.g. "By reason"). */
export function ReportSubheader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-[13.5px] font-semibold text-text">{title}</h3>
        {description && <p className="mt-0.5 text-[12.5px] text-text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Empty state wrapped in a card so it sits in the same grid as the tables. */
export function ReportEmpty({ icon, title, description, action }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card">
      <EmptyState icon={icon} title={title} description={description} action={action} />
    </div>
  );
}
