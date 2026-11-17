"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Share of stock value lost a year to miscounts, dead stock and rush orders, by how it is tracked. Illustrative. */
const TRACKING = [
  { id: "sheets", label: "Spreadsheets", rate: 0.07 },
  { id: "books", label: "Accounting app", rate: 0.05 },
  { id: "app", label: "Inventory app", rate: 0.03 },
] as const;

/** Each extra sales channel adds oversells and corrections on top of the base rate. */
const CHANNELS = [
  { id: "one", label: "One", factor: 1 },
  { id: "two", label: "Two", factor: 1.15 },
  { id: "more", label: "Three or more", factor: 1.3 },
] as const;

const STOCK_STEPS = [10_000, 25_000, 50_000, 75_000, 100_000, 150_000, 250_000, 400_000, 600_000, 800_000, 1_000_000, 1_500_000, 2_000_000];

/**
 * The hero's calculator: a rough yearly cost of running stock by hand, split
 * into inventory waste and wages. Every input is on screen and the assumptions
 * are printed under the result, so the figure is only as bold as the visitor makes it.
 * Kept compact: the sliders pair up from the sm breakpoint so the card stays shorter than the hero copy needs.
 */
export function WasteCalculator() {
  const [tracking, setTracking] = useState<(typeof TRACKING)[number]["id"]>("sheets");
  const [channels, setChannels] = useState<(typeof CHANNELS)[number]["id"]>("two");
  const [stockStep, setStockStep] = useState(6);
  const [people, setPeople] = useState(3);
  const [hours, setHours] = useState(6);
  const [wage, setWage] = useState(28);

  const stock = STOCK_STEPS[stockStep]!;
  const rate = TRACKING.find((t) => t.id === tracking)!.rate * CHANNELS.find((c) => c.id === channels)!.factor;
  const inventoryWaste = stock * rate;
  const wageWaste = people * hours * wage * 50;
  const total = inventoryWaste + wageWaste;

  return (
    <div className="overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-bevel),var(--shadow-card)]">
      <div className="p-4 sm:p-5">
        <h2 className="display-sm text-[18px]! leading-6!">What is stock costing you?</h2>

        <div className="mt-3 flex flex-col gap-3">
          <Choice legend="How do you track stock today?" name="track" value={tracking} options={TRACKING} onChange={setTracking} />
          <Choice legend="How many places do you sell?" name="channels" value={channels} options={CHANNELS} onChange={setChannels} />
          <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
            <Slider label="Stock on hand" value={stockStep} min={0} max={STOCK_STEPS.length - 1} onChange={setStockStep} display={money(stock)} />
            <Slider label="People handling stock" value={people} min={1} max={20} onChange={setPeople} display={String(people)} />
            <Slider label="Hours a week, each" value={hours} min={1} max={20} onChange={setHours} display={`${hours} h`} />
            <Slider label="Average hourly wage" value={wage} min={15} max={75} onChange={setWage} display={`$${wage}`} />
          </div>
        </div>
      </div>

      <div className="bg-brand-black p-4 text-band-text sm:p-5" aria-live="polite">
        {/* The figure scales to the card: each glyph of the expanded face is about 1.1em wide, so the size is the width divided by the character count, capped at 40px. */}
        <div className="[container-type:inline-size]">
          <div className="text-[12px] leading-4 text-band-text-secondary">Estimated cost a year</div>
          <div className="race-number mt-1 whitespace-nowrap text-band-text" style={{ fontSize: `min(40px, ${(100 / (money(total).length * 1.1)).toFixed(2)}cqw)` }}>
            {money(total)}
          </div>
        </div>
        <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] leading-5">
          <div className="flex gap-1.5">
            <dt className="text-band-text-secondary">Inventory waste</dt>
            <dd className="font-semibold tabular">{money(inventoryWaste)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-band-text-secondary">Wage waste</dt>
            <dd className="font-semibold tabular">{money(wageWaste)}</dd>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button size="lg" href="/product" iconRight={<ArrowRight />} className="bg-brand-red! text-white! shadow-none! hover:bg-brand-red-deep!">
            See how cumulusOS cuts this
          </Button>
          <Link href="/#demo" className="text-[13px] font-medium text-band-text underline-offset-4 hover:underline">
            Or book a demo
          </Link>
        </div>
        <p className="mt-3 text-[12px] leading-4 text-band-text-secondary">
          An estimate, not a quote. Assumes {Math.round(rate * 1000) / 10}% of stock value lost a year to miscounts, dead stock and rush orders for this setup, and the hours on counts and re-keying paid over 50 weeks.
        </p>
      </div>
    </div>
  );
}

function Choice<T extends string>({ legend, name, value, options, onChange }: { legend: string; name: string; value: T; options: ReadonlyArray<{ id: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="text-[13px] font-medium leading-5 text-text">{legend}</legend>
      <div className="mt-1 grid grid-cols-3 gap-1.5">
        {options.map((o) => (
          <label key={o.id} className="flex min-h-10 cursor-pointer items-center justify-center rounded-[var(--radius-sm)] bg-bg px-1.5 text-center text-[12.5px] font-medium leading-4 text-text shadow-[var(--shadow-button)] has-[:checked]:bg-brand-red has-[:checked]:text-white has-[:checked]:shadow-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-brand-black lg:min-h-8">
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
        <output htmlFor={id} className="shrink-0 font-semibold tabular text-brand-red">
          {display}
        </output>
      </div>
      <input id={id} type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={display} className="h-7 w-full cursor-pointer accent-[var(--brand-red)] lg:h-5" />
    </div>
  );
}
