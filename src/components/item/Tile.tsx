"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Compact metric used inside cards (lighter than the standalone Stat card). */
export function Tile({ label, value, hint, tone, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: "default" | "success" | "warning" | "critical"; className?: string }) {
  const toneCls = { default: "text-text", success: "text-success", warning: "text-warning", critical: "text-critical" }[tone ?? "default"];
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-[12px] font-medium text-text-secondary">{label}</div>
      <div className={cn("mt-0.5 truncate text-[18px] font-semibold leading-6 tracking-[-0.01em] tabular", toneCls)}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-[12px] text-text-tertiary">{hint}</div>}
    </div>
  );
}
