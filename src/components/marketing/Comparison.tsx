import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Reveal } from "./Reveal";
import { SectionTitle, container } from "./shared";

type Mark = "yes" | "partly" | "no";
type Cell = Mark | string;

const COLUMNS = ["cumulusOS", "Fishbowl", "Katana", "inFlow", "Spreadsheets"] as const;

/**
 * General, checkable points drawn from each product's public pages, November
 * 2026. "Partly" means offered on some plans, through add-ons or in part.
 */
const ROWS: Array<{ label: string; cells: [Cell, Cell, Cell, Cell, Cell] }> = [
  { label: "Time to a working system", cells: ["An afternoon, from your own spreadsheet", "Weeks, with paid implementation", "Days to weeks", "Days", "Hours, then it never ends"] },
  { label: "Agent that drafts bulk changes and waits for your approval", cells: ["yes", "no", "no", "no", "no"] },
  { label: "Imports from spreadsheets, photos, PDFs and text, with gaps filled", cells: ["yes", "partly", "partly", "partly", "no"] },
  { label: "Multi-level BOMs, builds and sub-assemblies", cells: ["yes", "yes", "yes", "partly", "no"] },
  { label: "Lot and heat-number traceability with FIFO or average costing", cells: ["yes", "yes", "partly", "partly", "no"] },
  { label: "Forecast-based replenishment and reorder rules", cells: ["yes", "yes", "yes", "partly", "no"] },
  { label: "Shopify, WooCommerce, Square, Clover and QuickBooks connections", cells: ["yes", "partly", "partly", "partly", "no"] },
  { label: "Barcode and QR labels, scanned from any phone", cells: ["yes", "yes", "partly", "yes", "no"] },
  { label: "Runs in the browser, nothing to install", cells: ["yes", "partly", "yes", "yes", "yes"] },
  { label: "Set up with the people who build it", cells: ["yes", "partly", "no", "no", "no"] },
  { label: "Pricing", cells: ["Per workspace, agreed with you", "Quote-based, annual", "Monthly tiers and user add-ons", "Monthly tiers by users", "Free, until the errors"] },
];

function CellView({ value, lead }: { value: Cell; lead: boolean }) {
  if (value === "yes")
    return (
      <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full", lead ? "bg-accent text-white" : "bg-success-soft text-success")} aria-label="Yes">
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  if (value === "partly") return <span className="inline-flex h-6 items-center rounded-full bg-surface-subdued px-2 text-[11.5px] font-medium text-text-secondary">Partly</span>;
  if (value === "no")
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full text-text-tertiary" aria-label="No">
        <Minus className="h-3.5 w-3.5" />
      </span>
    );
  return <span className={cn("text-[13px] leading-5", lead ? "font-medium text-text" : "text-text-secondary")}>{value}</span>;
}

export function Comparison() {
  return (
    <section id="compare" className="scroll-mt-16 border-t border-border">
      <div className={`${container} py-20 md:py-28`}>
        <SectionTitle title="Everything an ERP does, without the project." body="The usual choice is a heavy system that takes months to set up, or a spreadsheet that quietly drifts from the shelf. cumulusOS starts from the sheet you already have and is live the same afternoon, with an agent for the bulk work and the people who build it on the call." />
        <Reveal className="mt-12">
          <div className="overflow-x-auto rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-bevel),var(--shadow-card)]">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="w-[30%] px-5 py-4 text-[13px] font-[550] text-text-secondary">What matters</th>
                  {COLUMNS.map((c, i) => (
                    <th key={c} className={cn("px-4 py-4 text-[13.5px] font-semibold", i === 0 ? "bg-accent-soft/60 text-accent" : "text-text")}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.label} className="border-b border-border last:border-b-0">
                    <th scope="row" className="px-5 py-3.5 text-[13.5px] font-medium leading-5 text-text">
                      {r.label}
                    </th>
                    {r.cells.map((cell, i) => (
                      <td key={i} className={cn("px-4 py-3.5 align-middle", i === 0 && "bg-accent-soft/60")}>
                        <CellView value={cell} lead={i === 0} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-[12.5px] leading-5 text-text-tertiary">Based on each product&apos;s public pages in November 2026 and on how teams describe their rollouts to us. Plans change; check the current ones. Product names belong to their owners.</p>
        </Reveal>
        <ul className="mt-12 grid gap-6 md:grid-cols-3">
          {[
            { title: "Setup measured in hours", body: "Import your sheet, your QuickBooks or your store, and the workspace is live. We sit with you for the first import." },
            { title: "One ledger, every number", body: "Nothing edits on-hand directly. Builds, receipts, shipments and returns are movements, so what you see is what is on the shelf." },
            { title: "Bulk work by request", body: "Strato drafts the price change, the cycle count or the reorder, shows it in the table, and waits for a human to approve." },
          ].map((p, i) => (
            <Reveal key={p.title} delay={i * 60}>
              <li className="border-t-2 border-brand-red pt-4">
                <h3 className="text-[16px] font-semibold text-text">{p.title}</h3>
                <p className="mt-1.5 text-[14px] leading-6 text-text-secondary">{p.body}</p>
              </li>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
