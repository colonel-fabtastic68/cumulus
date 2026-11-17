"use client";

import { useId, useState, type CSSProperties } from "react";
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

/** The people who handle stock are counted at a full week, every working week of the year. */
const HOURS_A_WEEK = 40;
const WEEKS_A_YEAR = 50;

const STOCK_STEPS = [10_000, 25_000, 50_000, 75_000, 100_000, 150_000, 250_000, 400_000, 600_000, 800_000, 1_000_000, 1_500_000, 2_000_000];

const row = "px-4 py-3 sm:px-5";

/**
 * The hero's calculator: a rough yearly cost of running stock by hand, split
 * into inventory waste and the wages of the people who handle it, at a full
 * 40-hour week. Every input is on screen and the assumptions are printed under
 * the result, so the figure is only as bold as the visitor makes it.
 *
 * Drawn in three flat colors and nothing else: a black frame and title bar,
 * white rows split by black rules, a solid red block that holds the answer,
 * and a black strip for the two parts of it. Red marks only what moves or
 * matters: the slider handles and the answer.
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
    <div className="overflow-hidden rounded-[var(--radius-sm)] border-2 border-brand-black bg-surface">
      <div className="flex items-center gap-3 bg-brand-black px-4 py-3.5 sm:px-5">
        <span aria-hidden className="h-2.5 w-2.5 shrink-0 bg-brand-red" />
        <h2 className="display-sm text-[16px]! leading-6! text-white sm:text-[18px]!">What is stock costing you?</h2>
      </div>

      <div className="divide-y divide-brand-black">
        <div className={row}>
          <Choice legend="How do you track stock today?" name="track" value={tracking} options={TRACKING} onChange={setTracking} />
        </div>
        <div className={row}>
          <Slider label="Stock on hand" value={stockStep} min={0} max={STOCK_STEPS.length - 1} onChange={setStockStep} display={money(stock)} />
        </div>
        <div className="grid divide-y divide-brand-black sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <div className={row}>
            <Slider label="Inventory staff" value={people} min={1} max={20} onChange={setPeople} display={String(people)} />
          </div>
          <div className={row}>
            <Slider label="Hourly wage" value={wage} min={15} max={75} onChange={setWage} display={`$${wage}`} />
          </div>
        </div>
      </div>

      <div aria-live="polite">
        <div className="bg-brand-red px-4 pb-5 pt-4 text-white sm:px-5">
          {/* The figure scales to the card: a glyph of the expanded face runs just under 0.7em wide, so the size is the width divided by the character count at 0.74em each, capped at 56px. */}
          <div className="[container-type:inline-size]">
            <div className="text-[13px] font-semibold leading-5">Estimated cost a year</div>
            {/* The line keeps one height, so a longer figure set in smaller type never resizes the card. */}
            <div className="mt-1 flex h-[52px] items-end">
              <div className="race-number whitespace-nowrap" style={{ fontSize: `min(56px, ${(100 / (money(total).length * 0.74)).toFixed(2)}cqw)` }}>
                {money(total)}
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button size="lg" href="/product" iconRight={<ArrowRight />} className="h-10! rounded-[4px]! bg-white! px-4! text-[14px]! text-brand-black! shadow-none! hover:bg-[#ececec]!">
              See how cumulusOS cuts this
            </Button>
            <Link href="/#demo" className="text-[13px] font-semibold text-white underline underline-offset-4 hover:no-underline">
              Or book a demo
            </Link>
          </div>
        </div>
        <dl className="grid grid-cols-2 divide-x divide-white/25 bg-brand-black text-white">
          <div className="px-4 py-3 sm:px-5">
            <dt className="text-[12px] leading-4 text-white/75">Inventory waste</dt>
            <dd className="race-number mt-1.5 text-[17px]! leading-5!">{money(inventoryWaste)}</dd>
          </div>
          <div className="px-4 py-3 sm:px-5">
            <dt className="text-[12px] leading-4 text-white/75">Inventory wages</dt>
            <dd className="race-number mt-1.5 text-[17px]! leading-5!">{money(wages)}</dd>
          </div>
        </dl>
      </div>

      <p className="px-4 py-3 text-[12px] leading-4 text-text-secondary sm:px-5">
        An estimate, not a quote. Assumes {Math.round(rate * 1000) / 10}% of stock value lost a year to miscounts, dead stock and rush orders for this setup, and a {HOURS_A_WEEK}-hour week over {WEEKS_A_YEAR} weeks for each person on inventory staff.
      </p>
    </div>
  );
}

/** A strip of cells split by black rules; the picked cell fills black. */
function Choice<T extends string>({ legend, name, value, options, onChange }: { legend: string; name: string; value: T; options: ReadonlyArray<{ id: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="text-[13px] font-semibold leading-5 text-brand-black">{legend}</legend>
      <div className="mt-2 grid grid-cols-3 divide-x divide-brand-black overflow-hidden rounded-[4px] border border-brand-black">
        {options.map((o) => (
          <label key={o.id} className="flex min-h-10 cursor-pointer items-center justify-center px-1.5 text-center text-[12.5px] font-semibold leading-4 text-brand-black transition-colors duration-100 hover:bg-surface-active has-[:checked]:bg-brand-black has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-4 has-[:focus-visible]:outline-brand-red lg:min-h-9">
            <input type="radio" name={name} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A black rail filled to a square red handle (.calc-range in globals.css), with the value set large beside its label. */
function Slider({ label, value, min, max, onChange, display }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; display: string }) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-semibold leading-5 text-brand-black">
          {label}
        </label>
        <output htmlFor={id} className="race-number shrink-0 text-[16px]! leading-5! text-brand-black">
          {display}
        </output>
      </div>
      <input id={id} type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={display} className="calc-range mt-0.5" style={{ "--p": (value - min) / (max - min) } as CSSProperties} />
    </div>
  );
}
