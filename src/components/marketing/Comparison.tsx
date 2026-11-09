"use client";

import { useState } from "react";
import Image from "next/image";
import { Check, FileSpreadsheet, Minus } from "lucide-react";
import { AppIcon } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Reveal } from "./Reveal";
import { SectionTitle, container } from "./shared";

type Mark = "yes" | "partly" | "no";
type Cell = Mark | string;
type RivalId = "orion" | "fishbowl" | "katana" | "inflow" | "sheets";

/** Marks come from each vendor's own site (public/logos/compare) and only identify the product. */
const RIVALS: Array<{ id: RivalId; name: string; logo?: { src: string; width: number; height: number; rounded?: boolean } }> = [
  { id: "orion", name: "hpCommerce Orion", logo: { src: "/logos/compare/hpcommerce.png", width: 150, height: 72 } },
  { id: "fishbowl", name: "Fishbowl", logo: { src: "/logos/compare/fishbowl.png", width: 180, height: 180 } },
  { id: "katana", name: "Katana", logo: { src: "/logos/compare/katana.png", width: 180, height: 180, rounded: true } },
  { id: "inflow", name: "inFlow", logo: { src: "/logos/compare/inflow.svg", width: 31, height: 40 } },
  { id: "sheets", name: "Spreadsheets" },
];

/**
 * General, checkable points drawn from each product's public pages, November
 * 2026. "Partly" means offered on some plans, through add-ons or in part.
 */
const ROWS: Array<{ label: string; ours: Cell; theirs: Record<RivalId, Cell> }> = [
  { label: "Time to a working system", ours: "An afternoon, from your own spreadsheet", theirs: { orion: "Days, installed on your own PCs", fishbowl: "Weeks, with paid implementation", katana: "Days to weeks", inflow: "Days", sheets: "Hours, then it never ends" } },
  { label: "Agent that drafts bulk changes and waits for your approval", ours: "yes", theirs: { orion: "no", fishbowl: "no", katana: "no", inflow: "no", sheets: "no" } },
  { label: "Imports from spreadsheets, photos, PDFs and text, with gaps filled", ours: "yes", theirs: { orion: "partly", fishbowl: "partly", katana: "partly", inflow: "partly", sheets: "no" } },
  { label: "Multi-level BOMs, builds and sub-assemblies", ours: "yes", theirs: { orion: "partly", fishbowl: "yes", katana: "yes", inflow: "partly", sheets: "no" } },
  { label: "Lot and heat-number traceability with FIFO or average costing", ours: "yes", theirs: { orion: "no", fishbowl: "yes", katana: "partly", inflow: "partly", sheets: "no" } },
  { label: "Forecast-based replenishment and reorder rules", ours: "yes", theirs: { orion: "partly", fishbowl: "yes", katana: "yes", inflow: "partly", sheets: "no" } },
  { label: "Shopify, WooCommerce, Square, Clover and QuickBooks connections", ours: "yes", theirs: { orion: "partly", fishbowl: "partly", katana: "partly", inflow: "partly", sheets: "no" } },
  { label: "Barcode and QR labels, scanned from any phone", ours: "yes", theirs: { orion: "partly", fishbowl: "yes", katana: "partly", inflow: "yes", sheets: "no" } },
  { label: "Runs in the browser, nothing to install", ours: "yes", theirs: { orion: "no", fishbowl: "partly", katana: "yes", inflow: "yes", sheets: "yes" } },
  { label: "Set up with the people who build it", ours: "yes", theirs: { orion: "partly", fishbowl: "partly", katana: "no", inflow: "no", sheets: "no" } },
  { label: "Pricing", ours: "Per workspace, agreed with you", theirs: { orion: "Yearly license, per-user add-ons", fishbowl: "Quote-based, annual", katana: "Monthly tiers and user add-ons", inflow: "Monthly tiers by users", sheets: "Free, until the errors" } },
];

function RivalMark({ id, size = 20 }: { id: RivalId; size?: number }) {
  const rival = RIVALS.find((r) => r.id === id)!;
  if (!rival.logo) return <FileSpreadsheet aria-hidden className="shrink-0 text-icon" style={{ width: size, height: size }} />;
  const { src, width, height, rounded } = rival.logo;
  return <Image src={src} alt="" aria-hidden unoptimized width={Math.round((width / height) * size)} height={size} className={cn("shrink-0", rounded && "rounded-[5px]")} style={{ height: size, width: "auto" }} />;
}

function CellView({ value, lead }: { value: Cell; lead: boolean }) {
  if (value === "yes")
    return (
      <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full", lead ? "bg-brand-red text-white" : "bg-success-soft text-success")}>
        <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={3} />
        <span className="sr-only">Yes</span>
      </span>
    );
  if (value === "partly") return <span className="inline-flex h-6 items-center rounded-full bg-surface-subdued px-2 text-[11.5px] font-medium text-text-secondary">Partly</span>;
  if (value === "no")
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full text-text-tertiary">
        <Minus aria-hidden className="h-3.5 w-3.5" />
        <span className="sr-only">No</span>
      </span>
    );
  return <span className={cn("text-[13px] leading-5", lead ? "font-medium text-text" : "text-text-secondary")}>{value}</span>;
}

export function Comparison() {
  const [picked, setPicked] = useState<RivalId>("orion");
  const rival = RIVALS.find((r) => r.id === picked)!;
  return (
    <section id="compare" className="scroll-mt-16 border-t border-border">
      <div className={`${container} py-20 md:py-28`}>
        <SectionTitle title="Everything an ERP does, without the project." body="The usual choice is a heavy system that takes months to set up, desktop software tied to one counter, or a spreadsheet that quietly drifts from the shelf. cumulusOS starts from the sheet you already have and is live the same afternoon, with an agent for the bulk work and the people who build it on the call." />

        {/* Wide screens: every product side by side. */}
        <Reveal className="mt-12 hidden lg:block">
          <div className="overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-bevel),var(--shadow-card)]">
            <table className="w-full table-fixed border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="w-[24%] px-5 py-4 align-bottom text-[13px] font-[550] text-text-secondary">What matters</th>
                  <th className="bg-accent-soft/60 px-4 py-4 align-bottom text-[13.5px] font-semibold text-brand-red">
                    <span className="flex flex-col items-start gap-2">
                      <AppIcon size={22} />
                      cumulusOS
                    </span>
                  </th>
                  {RIVALS.map((r) => (
                    <th key={r.id} className="px-4 py-4 align-bottom text-[13.5px] font-semibold text-text">
                      <span className="flex flex-col items-start gap-2">
                        <RivalMark id={r.id} size={22} />
                        <span className="min-w-0">{r.name}</span>
                      </span>
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
                    <td className="bg-accent-soft/60 px-4 py-3.5 align-middle">
                      <CellView value={r.ours} lead />
                    </td>
                    {RIVALS.map((c) => (
                      <td key={c.id} className="px-4 py-3.5 align-middle">
                        <CellView value={r.theirs[c.id]} lead={false} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        {/* Phones and tablets: pick one product and read it against cumulusOS. */}
        <Reveal className="mt-10 lg:hidden">
          <fieldset>
            <legend className="text-[13.5px] font-medium text-text">Compare cumulusOS with</legend>
            <div className="mt-3 flex flex-wrap gap-2">
              {RIVALS.map((r) => (
                <label key={r.id} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] bg-surface px-3 text-[13px] font-medium text-text shadow-[var(--shadow-button)] has-[:checked]:bg-brand-black has-[:checked]:text-white has-[:checked]:shadow-none has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent">
                  <input type="radio" name="compare-with" value={r.id} checked={picked === r.id} onChange={() => setPicked(r.id)} className="sr-only" />
                  <span className={cn("inline-flex", picked === r.id && r.logo && "rounded-[4px] bg-white p-0.5")}>
                    <RivalMark id={r.id} size={18} />
                  </span>
                  {r.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="mt-4 overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-bevel),var(--shadow-card)]">
            <table className="w-full table-fixed border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="w-[42%] px-4 py-3 text-[12.5px] font-[550] text-text-secondary">What matters</th>
                  <th className="bg-accent-soft/60 px-3 py-3 text-[12.5px] font-semibold text-brand-red">cumulusOS</th>
                  <th className="px-3 py-3 text-[12.5px] font-semibold text-text">{rival.name}</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.label} className="border-b border-border last:border-b-0">
                    <th scope="row" className="px-4 py-3 text-[13px] font-medium leading-5 text-text">
                      {r.label}
                    </th>
                    <td className="bg-accent-soft/60 px-3 py-3 align-middle">
                      <CellView value={r.ours} lead />
                    </td>
                    <td className="px-3 py-3 align-middle">
                      <CellView value={r.theirs[picked]} lead={false} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        <p className="mt-4 text-[12.5px] leading-5 text-text-tertiary">Based on each product&apos;s public pages in November 2026 and on how teams describe their rollouts to us. Plans change; check the current ones. Product names and marks belong to their owners and appear only to identify what is being compared.</p>

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
