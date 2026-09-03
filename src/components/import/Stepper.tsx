"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WizardStep } from "./types";

const STEPS: Array<{ step: WizardStep; label: string }> = [
  { step: 1, label: "Upload" },
  { step: 2, label: "Map columns" },
  { step: 3, label: "Review" },
  { step: 4, label: "Done" },
];

export function Stepper({ current, onStepClick }: { current: WizardStep; onStepClick?: (step: WizardStep) => void }) {
  return (
    <ol className="card mb-4 flex items-center px-3 py-2.5 sm:px-4" aria-label="Import progress">
      {STEPS.map((s, i) => {
        const done = s.step < current;
        const active = s.step === current;
        const clickable = done && current !== 4 && !!onStepClick;
        return (
          <li key={s.step} className={cn("flex min-w-0 items-center", i < STEPS.length - 1 && "flex-1")}>
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onStepClick?.(s.step)}
              aria-current={active ? "step" : undefined}
              className={cn("flex min-w-0 items-center gap-2 rounded-[var(--radius-sm)] px-1 py-0.5 text-left", clickable ? "cursor-pointer hover:bg-surface-hover" : "cursor-default")}
            >
              <span
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11.5px] font-semibold tabular",
                  done && "border-primary bg-primary text-text-inverse",
                  active && "border-primary bg-surface text-text",
                  !done && !active && "border-border-strong bg-surface text-text-tertiary",
                )}
              >
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : s.step}
              </span>
              <span className={cn("truncate text-[12.5px] font-medium", active ? "text-text" : done ? "text-text-secondary" : "text-text-tertiary", !active && "hidden sm:inline")}>{s.label}</span>
            </button>
            {i < STEPS.length - 1 && <span aria-hidden className={cn("mx-2 h-px flex-1 sm:mx-3", done ? "bg-primary/60" : "bg-border")} />}
          </li>
        );
      })}
    </ol>
  );
}
