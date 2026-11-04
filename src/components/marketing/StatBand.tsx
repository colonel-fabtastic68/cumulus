import type { ReactNode } from "react";
import { Reveal } from "./Reveal";
import { Rule, container } from "./shared";

/** Three true figures about the product. Pilot results go here once teams agree to share them. */
const FIGURES: Array<{ value: ReactNode; caption: string }> = [
  { value: <>30<em>min</em></>, caption: "From a spreadsheet you bring to a demo on your own parts." },
  { value: <>7</>, caption: "Stores, registers, books and carriers it connects to today." },
  { value: <>0</>, caption: "Installs. It runs in the browser on any device in the shop." },
];

/** The dark proof band: brand black with a red edge and race-number figures. */
export function StatBand() {
  return (
    <section aria-labelledby="proof-title" className="relative overflow-hidden bg-brand-black text-band-text">
      <span aria-hidden className="absolute inset-y-0 right-0 w-1.5 bg-brand-red" />
      <div className={`${container} py-16 md:py-20`}>
        <Reveal>
          <Rule tone="band" />
          <h2 id="proof-title" className="display mt-5 text-band-text">
            No implementation project. Just your parts, live.
          </h2>
        </Reveal>
        <div className="mt-10 grid border-t border-band-border md:grid-cols-3">
          {FIGURES.map((f, i) => (
            <Reveal key={f.caption} delay={i * 70}>
              <div className={`py-6 md:pr-6 ${i > 0 ? "border-t border-band-border md:border-t-0 md:border-l md:pl-6" : ""}`}>
                <span className="race-number block text-band-text">{f.value}</span>
                <p className="mt-3 max-w-[18em] text-[13px] leading-5 text-band-text-secondary">{f.caption}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
