import { cn } from "@/lib/utils";
import { Reveal } from "./Reveal";
import { container } from "./shared";

/**
 * Off the home page since 2026-11-09 while each team approves the use of its name; put `<CustomerLogos />` back in the landing page when they do.
 * Who builds with cumulusOS. Names are set as wordmarks until each team sends
 * a logo file; a `placeholder` entry holds a slot open. Add a row here to add a logo.
 */
const CUSTOMERS: Array<{ name: string; note: string; placeholder?: boolean }> = [
  { name: "Longhorn Chassis", note: "Chassis builder" },
  { name: "Willo Ranch", note: "Ranch and farm store" },
  { name: "Your race team", note: "Logo coming", placeholder: true },
  { name: "Your wheel brand", note: "Logo coming", placeholder: true },
  { name: "Your parts shop", note: "Logo coming", placeholder: true },
];

export function CustomerLogos() {
  return (
    <section aria-label="Customers" className="border-y border-border bg-surface">
      <div className={`${container} py-8 md:py-10`}>
        <Reveal>
          <p className="text-center text-[13.5px] font-medium text-text-secondary">Built with the teams who build the cars</p>
          <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {CUSTOMERS.map((c) => (
              <li key={c.name} className={cn("flex h-16 flex-col items-center justify-center rounded-[var(--radius)] px-3 text-center", c.placeholder ? "border border-dashed border-border-strong" : "bg-bg shadow-[var(--shadow-bevel)]")}>
                <span className={cn("text-[15px] font-semibold tracking-[-0.01em]", c.placeholder ? "text-text-tertiary" : "text-text")}>{c.name}</span>
                <span className="mt-0.5 text-[11.5px] text-text-tertiary">{c.note}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
