import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type BadgeTone = "default" | "info" | "success" | "warning" | "critical" | "accent";

const tones: Record<BadgeTone, string> = {
  default: "bg-surface-hover text-text-secondary",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  critical: "bg-critical-soft text-critical",
  accent: "bg-accent-soft text-accent",
};

export function Badge({ tone = "default", children, className, dot }: { tone?: BadgeTone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11.5px] font-medium leading-4 whitespace-nowrap", tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: BadgeTone; label?: string }> = {
    active: { tone: "success" },
    inactive: { tone: "default" },
    superseded: { tone: "warning" },
    open: { tone: "info" },
    inspecting: { tone: "warning" },
    fulfilled: { tone: "success" },
    received: { tone: "success" },
    completed: { tone: "success" },
    planned: { tone: "info" },
    restocked: { tone: "success" },
    refunded: { tone: "default" },
    scrapped: { tone: "critical" },
    cancelled: { tone: "default" },
    draft: { tone: "default" },
    connected: { tone: "success" },
    not_connected: { tone: "default", label: "Not connected" },
    error: { tone: "critical" },
    invited: { tone: "info" },
  };
  const m = map[status] ?? { tone: "default" as BadgeTone };
  return <Badge tone={m.tone}>{m.label ?? status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())}</Badge>;
}
