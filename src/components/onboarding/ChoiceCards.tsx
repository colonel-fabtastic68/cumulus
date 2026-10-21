"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { TextField } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface Choice {
  id: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
}

interface ChoiceCardsProps {
  options: Choice[];
  selected: string[];
  onToggle: (id: string) => void;
  /** One choice at a time (radio semantics). */
  single?: boolean;
  /** Choice ids that clear the others when picked ("none"). */
  exclusive?: string[];
  columns?: 1 | 2 | 3;
  /** Free text shown under the grid while this choice is selected. */
  other?: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string };
}

/** Big tappable cards for the setup questions: a thumb-sized target on phones, a tidy grid on desktop. */
export function ChoiceCards({ options, selected, onToggle, single, exclusive = [], columns = 2, other }: ChoiceCardsProps) {
  const cols = { 1: "grid-cols-1", 2: "grid-cols-1 sm:grid-cols-2", 3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" }[columns];
  return (
    <div className="flex flex-col gap-3">
      <div role={single ? "radiogroup" : "group"} className={cn("grid gap-2.5", cols)}>
        {options.map((o, i) => {
          const on = selected.includes(o.id);
          return (
            <button
              key={o.id}
              type="button"
              role={single ? "radio" : "checkbox"}
              aria-checked={on}
              onClick={() => onToggle(o.id)}
              style={{ animationDelay: `${i * 55}ms` }}
              className={cn(
                "float-in group flex min-h-[64px] items-center gap-3 rounded-[var(--radius)] border bg-surface px-4 py-3 text-left transition-[border-color,box-shadow,background-color] duration-150",
                on ? "border-primary shadow-[inset_0_0_0_1px_var(--primary)]" : "border-border hover:border-border-strong hover:bg-surface-hover",
                exclusive.includes(o.id) && "sm:col-span-full",
              )}
            >
              {o.icon && <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", on ? "bg-primary text-text-inverse" : "bg-surface-subdued text-text-secondary")}>{o.icon}</span>}
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium leading-5 text-text">{o.label}</span>
                {o.hint && <span className="block text-[12.5px] leading-[18px] text-text-secondary">{o.hint}</span>}
              </span>
              <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors", on ? "border-primary bg-primary text-text-inverse" : "border-border-strong bg-surface", single && "rounded-full")} aria-hidden>
                {on && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
            </button>
          );
        })}
      </div>
      {other && selected.includes(other.id) && <TextField label={other.label} value={other.value} onChange={(e) => other.onChange(e.target.value)} placeholder={other.placeholder} autoFocus />}
    </div>
  );
}
