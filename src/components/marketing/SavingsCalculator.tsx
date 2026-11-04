"use client";

import { useState } from "react";

const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * A rough, adjustable estimate of what re-keying between systems costs. Every
 * input is on screen, so the number is only as bold as the reader makes it.
 */
export function SavingsCalculator() {
  const [hours, setHours] = useState(8);
  const [rate, setRate] = useState(32);
  const [people, setPeople] = useState(2);
  const weekly = hours * rate * people;
  const yearly = weekly * 50;
  return (
    <div className="rounded-[var(--radius-lg)] bg-bg p-6 shadow-[var(--shadow-bevel),var(--shadow-card)] md:p-8">
      <h3 className="display-sm">What does re-keying cost you?</h3>
      <p className="mt-1.5 text-[13.5px] leading-6 text-text-secondary">Orders typed from the store into the sheet, counts typed from the sheet into accounting, stock levels fixed by hand after every sale. Move the sliders to your shop.</p>
      <div className="mt-6 grid gap-5">
        <Slider label="Hours a week spent copying data between systems, per person" value={hours} min={1} max={25} step={1} onChange={setHours} format={(v) => `${v} h`} />
        <Slider label="Loaded hourly cost of that person" value={rate} min={15} max={90} step={1} onChange={setRate} format={(v) => `$${v}`} />
        <Slider label="People who do it" value={people} min={1} max={10} step={1} onChange={setPeople} format={(v) => `${v}`} />
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[var(--radius)] bg-surface px-4 py-3 shadow-[var(--shadow-bevel)]">
          <div className="text-[12.5px] font-medium text-text-secondary">Every week</div>
          <div className="mt-1 text-[24px] font-semibold tabular text-text">{fmt(weekly)}</div>
        </div>
        <div className="rounded-[var(--radius)] bg-accent-soft px-4 py-3">
          <div className="text-[12.5px] font-medium text-accent">Every year, 50 working weeks</div>
          <div className="mt-1 text-[24px] font-semibold tabular text-accent">{fmt(yearly)}</div>
        </div>
      </div>
      <p className="mt-4 text-[12.5px] leading-5 text-text-tertiary">Labor only. It leaves out the oversold order, the part counted twice, and the container that landed before anyone updated the sheet. Shops we talk to put the manual work at six to ten hours a week per person before connecting their systems.</p>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, format }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
        <span className="text-text">{label}</span>
        <span className="font-semibold tabular text-text">{format(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-[var(--accent)]" />
    </label>
  );
}
