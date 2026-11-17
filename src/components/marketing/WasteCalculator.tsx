"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Share of stock value lost a year to miscounts, dead stock and rush orders, by how it is tracked. Illustrative. */
const TRACKING = [
  { id: "sheets", label: "Spreadsheets", rate: 0.07 },
  { id: "books", label: "Accounting app", rate: 0.05 },
  { id: "app", label: "Inventory app", rate: 0.03 },
] as const;

/** The people who handle stock are counted at a full week, every working week of the year. */
const HOURS_A_WEEK = 40;
const WEEKS_A_YEAR = 50;

const STOCK_STEPS = [10_000, 25_000, 50_000, 75_000, 100_000, 150_000, 250_000, 400_000, 600_000, 800_000, 1_000_000, 1_500_000, 2_000_000];

/**
 * The hero's calculator: a rough yearly cost of running stock by hand, split
 * into inventory waste and the wages of the people who handle it, at a full
 * 40-hour week. Every input is on screen and the assumptions are printed under
 * the result, so the figure is only as bold as the visitor makes it.
 *
 * Drawn as a ruled sheet: a flat card, hairlines between numbered rows, black
 * controls, and one solid red block that holds the answer. Red appears only on
 * the row numbers and that block.
 */
export function WasteCalculator() {
  const [tracking, setTracking] = useState<(typeof TRACKING)[number]["id"]>("sheets");
  const [stockStep, setStockStep] = useState(6);
  const [people, setPeople] = useState(3);
  const [wage, setWage] = useState(28);

  const stock = STOCK_STEPS[stockStep]!;
  const rate = TRACKING.find((t) => t.id === tracking)!.rate;
  const inventoryWaste = stock * rate;
  const wages = people * HOURS_A_WEEK * wage * WEEKS_A_YEAR;
  const total = inventoryWaste + wages;

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] border border-border-strong bg-surface">
      <div className="flex items-start gap-2.5 border-b border-border px-4 py-3 sm:px-5">
        <span aria-hidden className="mt-2 h-2 w-2 shrink-0 bg-brand-red" />
        <h2 className="display-sm text-[18px]! leading-6!">What is stock costing you?</h2>
      </div>

      <div className="divide-y divide-border">
        <Row n={1}>
          <Choice legend="How do you track stock today?" name="track" value={tracking} options={TRACKING} onChange={setTracking} />
        </Row>
        <Row n={2}>
          <Slider label="Stock on hand" value={stockStep} min={0} max={STOCK_STEPS.length - 1} onChange={setStockStep} display={money(stock)} />
        </Row>
        <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <Row n={3}>
            <Slider label="Inventory staff" value={people} min={1} max={20} onChange={setPeople} display={String(people)} />
          </Row>
          <Row n={4}>
            <Slider label="Hourly wage" value={wage} min={15} max={75} onChange={setWage} display={`$${wage}`} />
          </Row>
        </div>
      </div>

      <div className="bg-brand-red text-white" aria-live="polite">
        <div className="px-4 pt-4 sm:px-5">
          {/* The figure scales to the card: each glyph of the expanded face is about 1.1em wide, so the size is the width divided by the character count, capped at 44px. */}
          <div className="[container-type:inline-size]">
            <div className="text-[12px] leading-4 text-white/90">Estimated cost a year</div>
            {/* The line keeps one height, so a longer figure set in smaller type never resizes the card. */}
            <div className="mt-1 flex h-10 items-end">
              <div className="race-number whitespace-nowrap" style={{ fontSize: `min(44px, ${(100 / (money(total).length * 1.1)).toFixed(2)}cqw)` }}>
                {money(total)}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button size="lg" href="/product" iconRight={<ArrowRight />} className="bg-brand-black! text-white! shadow-none! hover:bg-[#262626]!">
              See how cumulusOS cuts this
            </Button>
            <Link href="/#demo" className="text-[13px] font-medium text-white underline-offset-4 hover:underline">
              Or book a demo
            </Link>
          </div>
        </div>
        <dl className="mt-3 grid grid-cols-2 divide-x divide-white/25 border-t border-white/25">
          <div className="px-4 py-3 sm:px-5">
            <dt className="text-[12px] leading-4 text-white/90">Inventory waste</dt>
            <dd className="mt-0.5 text-[14px] font-semibold leading-5 tabular">{money(inventoryWaste)}</dd>
          </div>
          <div className="px-4 py-3 sm:px-5">
            <dt className="text-[12px] leading-4 text-white/90">Inventory wages</dt>
            <dd className="mt-0.5 text-[14px] font-semibold leading-5 tabular">{money(wages)}</dd>
          </div>
        </dl>
      </div>

      <p className="bg-surface-subdued px-4 py-3 text-[12px] leading-4 text-text-secondary sm:px-5">
        An estimate, not a quote. Assumes {Math.round(rate * 1000) / 10}% of stock value lost a year to miscounts, dead stock and rush orders for this setup, and a {HOURS_A_WEEK}-hour week over {WEEKS_A_YEAR} weeks for each person on inventory staff.
      </p>
    </div>
  );
}

/** One ruled row of the sheet: its number in red, then the control. */
function Row({ n, children, className }: { n: number; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid grid-cols-[28px_minmax(0,1fr)] px-4 py-3 sm:px-5", className)}>
      <span aria-hidden className="race-number text-[13px]! leading-5! text-brand-red">
        0{n}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A strip of cells split by hairlines; the picked cell fills black. */
function Choice<T extends string>({ legend, name, value, options, onChange }: { legend: string; name: string; value: T; options: ReadonlyArray<{ id: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="text-[13px] font-medium leading-5 text-text">{legend}</legend>
      <div className="mt-1.5 grid grid-cols-3 divide-x divide-border-strong overflow-hidden rounded-[var(--radius-sm)] border border-border-strong">
        {options.map((o) => (
          <label key={o.id} className="flex min-h-10 cursor-pointer items-center justify-center px-1.5 text-center text-[12.5px] font-medium leading-4 text-text transition-colors duration-100 hover:bg-surface-subdued has-[:checked]:bg-brand-black has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-brand-red lg:min-h-8">
            <input type="radio" name={name} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Slider({ label, value, min, max, onChange, display }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; display: string }) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[13px] leading-5">
        <label htmlFor={id} className="font-medium text-text">
          {label}
        </label>
        <output htmlFor={id} className="shrink-0 font-semibold tabular text-text">
          {display}
        </output>
      </div>
      <input id={id} type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={display} className="h-7 w-full cursor-pointer accent-[var(--brand-black)] lg:h-5" />
    </div>
  );
}
