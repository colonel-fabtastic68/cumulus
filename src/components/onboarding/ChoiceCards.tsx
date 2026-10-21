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
  /** Short bullets under the hint on the big cards. */
  points?: string[];
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
  /** Three tall cards side by side (icon on top, bullets underneath) instead of the compact rows. */
  big?: boolean;
}

/** Big tappable cards for the setup questions: a thumb-sized target on phones, a tidy grid on desktop. */
export function ChoiceCards({ options, selected, onToggle, single, exclusive = [], columns = 2, other, big }: ChoiceCardsProps) {
  const cols = big ? "grid-cols-1 md:grid-cols-3" : { 1: "grid-cols-1", 2: "grid-cols-1 sm:grid-cols-2", 3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" }[columns];
  if (big)
    return (
      <div className="flex flex-col gap-3">
        <div role={single ? "radiogroup" : "group"} className={cn("grid gap-4", cols)}>
          {options.map((o, i) => {
            const on = selected.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                role={single ? "radio" : "checkbox"}
                aria-checked={on}
                onClick={() => onToggle(o.id)}
                style={{ animationDelay: `${i * 110}ms` }}
                className={cn(
                  "float-in relative flex min-h-[280px] flex-col items-start rounded-[var(--radius-lg)] border bg-surface p-5 text-left shadow-[var(--shadow-card)] transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5",
                  on ? "border-primary shadow-[inset_0_0_0_1px_var(--primary),var(--shadow-card)]" : "border-border hover:border-border-strong",
                )}
              >
                <span className={cn("absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full border transition-colors", on ? "border-primary bg-primary text-text-inverse" : "border-border-strong bg-surface")} aria-hidden>
                  {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                </span>
                {o.icon && <span className={cn("mb-4 flex h-12 w-12 items-center justify-center rounded-full [&>svg]:h-5 [&>svg]:w-5", on ? "bg-primary text-text-inverse" : "bg-surface-subdued text-text-secondary")}>{o.icon}</span>}
                <span className="block text-[17px] font-semibold leading-6 text-text">{o.label}</span>
                {o.hint && <span className="mt-1.5 block text-[13.5px] leading-5 text-text-secondary">{o.hint}</span>}
                {o.points && o.points.length > 0 && (
                  <ul className="mt-4 flex flex-col gap-1.5">
                    {o.points.map((pt) => (
                      <li key={pt} className="flex gap-2 text-[13px] leading-5 text-text">
                        <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-success" />
                        {pt}
                      </li>
                    ))}
                  </ul>
                )}
              </button>
            );
          })}
        </div>
        {other && selected.includes(other.id) && <TextField label={other.label} value={other.value} onChange={(e) => other.onChange(e.target.value)} placeholder={other.placeholder} autoFocus />}
      </div>
    );
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
