"use client";

import { useId, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui";

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
 * It is the same card as SavingsCalculator on the Integrations page: an
 * off-white surface with the kit's bevel, sliders in the accent color, white
 * tiles for the parts and one soft red tile for the total.
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
    <div className="rounded-[var(--radius-lg)] bg-bg p-5 text-text shadow-[var(--shadow-bevel),var(--shadow-card)] sm:p-6">
      <h2 className="display-sm text-[20px]! leading-6!">What is stock costing you?</h2>

      <div className="mt-4 grid gap-4">
        <Choice legend="How do you track stock today?" name="track" value={tracking} options={TRACKING} onChange={setTracking} />
        <Slider label="Stock on hand" value={stockStep} min={0} max={STOCK_STEPS.length - 1} onChange={setStockStep} display={money(stock)} />
        <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
          <Slider label="Inventory staff" value={people} min={1} max={20} onChange={setPeople} display={String(people)} />
          <Slider label="Hourly wage" value={wage} min={15} max={75} onChange={setWage} display={`$${wage}`} />
        </div>
      </div>

      <div className="mt-5 grid gap-3" aria-live="polite">
        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-[var(--radius)] bg-surface px-3 py-2.5 shadow-[var(--shadow-bevel)] sm:px-4 sm:py-3">
            <dt className="text-[12.5px] font-medium text-text-secondary">Inventory waste</dt>
            <dd className="mt-0.5 text-[18px] font-semibold tabular text-text sm:text-[20px]">{money(inventoryWaste)}</dd>
          </div>
          <div className="rounded-[var(--radius)] bg-surface px-3 py-2.5 shadow-[var(--shadow-bevel)] sm:px-4 sm:py-3">
            <dt className="text-[12.5px] font-medium text-text-secondary">Inventory wages</dt>
            <dd className="mt-0.5 text-[18px] font-semibold tabular text-text sm:text-[20px]">{money(wages)}</dd>
          </div>
        </dl>
        <div className="flex flex-col rounded-[var(--radius)] bg-accent-soft px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
          <div className="text-[12.5px] font-medium text-accent">Estimated cost a year</div>
          <div className="text-[24px] font-semibold leading-8 tabular text-accent">{money(total)}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" size="lg" href="/product" iconRight={<ArrowRight />}>
          See how cumulusOS cuts this
        </Button>
        <Button variant="plain" size="lg" href="/#demo">
          Or book a demo
        </Button>
      </div>

      <p className="mt-4 text-[12px] leading-4 text-text-tertiary">
        An estimate, not a quote. Assumes {Math.round(rate * 1000) / 10}% of stock value lost a year to miscounts, dead stock and rush orders for this setup, and a {HOURS_A_WEEK}-hour week over {WEEKS_A_YEAR} weeks for each person on inventory staff.
      </p>
    </div>
  );
}

/** Radios drawn as the kit's Segmented control: a grey track with the picked option on a white chip. */
function Choice<T extends string>({ legend, name, value, options, onChange }: { legend: string; name: string; value: T; options: ReadonlyArray<{ id: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="text-[13.5px] text-text">{legend}</legend>
      <div className="mt-2 grid grid-cols-3 gap-0.5 rounded-[var(--radius-sm)] bg-fill-tertiary p-0.5">
        {options.map((o) => (
          <label key={o.id} className="flex min-h-9 cursor-pointer items-center justify-center rounded-[6px] px-1.5 text-center text-[12px] font-[550] leading-4 text-text-secondary transition-colors hover:bg-[rgba(0,0,0,0.04)] hover:text-text has-[:checked]:bg-surface has-[:checked]:text-text has-[:checked]:shadow-[var(--shadow-100),0_0_0_1px_rgba(26,26,26,0.07)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent lg:min-h-8">
            <input type="radio" name={name} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The same slider as SavingsCalculator: label and value on one line, the browser's own range control in the accent color. */
function Slider({ label, value, min, max, onChange, display }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; display: string }) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
        <label htmlFor={id} className="text-text">
          {label}
        </label>
        <output htmlFor={id} className="shrink-0 font-semibold tabular text-text">
          {display}
        </output>
      </div>
      <input id={id} type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={display} className="mt-2 block w-full accent-[var(--accent)]" />
    </div>
  );
}
