import type { Metadata } from "next";
import { Barcode, CalendarRange, Layers, PackageCheck, RotateCcw, Store } from "lucide-react";
import { Badge, SimpleTable } from "@/components/ui";
import { Reveal } from "@/components/marketing/Reveal";
import { CheckList, CtaBand, FeatureGrid, PageHero, PainPoints, SectionTitle, container } from "@/components/marketing/shared";

export const metadata: Metadata = {
  title: "Aftermarket automotive · cumulusOS",
  description: "Inventory for aftermarket automotive manufacturers and dealers: thousands of SKUs by fitment and finish, one count across the web store, the counter and dealers, containers received at landed cost, and returns handled in the same ledger.",
};

const PAINS = [
  { pain: "The web store, the counter and the dealer portal each think they have the last set of wheels.", fix: "One count, read by every channel.", detail: "Shopify or WooCommerce, the Square or Clover register and dealer orders all pull from the same stock. A sale anywhere pushes the new level everywhere within seconds." },
  { pain: "A container lands and the margins are a guess until someone reconciles freight weeks later.", fix: "Receiving back-dated to the day it landed, with landed cost per lot.", detail: "Book the container against its POs, spread freight and duty across the lots, and let FIFO or average costing carry the real margin into every sale." },
  { pain: "Three thousand SKUs across sizes, offsets and finishes, and the spreadsheet has four tabs nobody trusts.", fix: "Variants with custom fields for fitment, and a barcode on each one.", detail: "Import the catalog you have; unknown columns become fields. Labels print by the sheet, phones scan them, and Strato updates prices or minimums across a whole family in one approval." },
  { pain: "Fitment returns pile up and nobody can say which SKU keeps coming back.", fix: "RMAs through inspection to restock or write-off, with the reason on each line.", detail: "Returns land in the same ledger as sales, so the return rate per SKU is a report, not an argument, and restocked parts are sellable the moment they pass inspection." },
];

const FEATURES = [
  { icon: Store, title: "Every channel, one stock", body: "Shopify, WooCommerce, Square, Clover and wholesale orders on the same count, with webhooks keeping it live." },
  { icon: Layers, title: "Variants and fitment", body: "Custom fields for year, make, model, bolt pattern or finish, searchable and exportable." },
  { icon: PackageCheck, title: "Landed cost receiving", body: "Containers booked on the day they landed, freight and duty spread across lots, FIFO or average." },
  { icon: CalendarRange, title: "Seasonal replenishment", body: "Monthly demand curves and days of cover turn into a purchase plan that lands before the season, not during it." },
  { icon: Barcode, title: "Labels and scanning", body: "Barcode and QR labels for SKUs, lots and bins; pick, count and receive with a phone." },
  { icon: RotateCcw, title: "Returns that teach", body: "Inspection, restock or write-off, and a return rate per SKU straight from the ledger." },
];

const CHANNELS = [
  { sku: "WHL-18x9.5-ET35-GM", channel: "Web store", qty: 14, note: "Pushed 2 min ago" },
  { sku: "WHL-18x9.5-ET35-GM", channel: "Counter (Square)", qty: 14, note: "Same count" },
  { sku: "WHL-18x9.5-ET35-GM", channel: "Dealer orders", qty: 14, note: "6 reserved" },
] as const;

function ChannelCard() {
  return (
    <div className="card overflow-hidden text-[13px] leading-5" aria-hidden>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <div className="leading-tight">
          <div className="font-semibold text-text">One SKU, three channels</div>
          <div className="text-[11.5px] text-text-tertiary">18×9.5 ET35 gunmetal · Lot 2211 · landed $142.60</div>
        </div>
        <Badge tone="success" className="ml-auto">
          In sync
        </Badge>
      </div>
      <SimpleTable>
        <thead>
          <tr>
            <th>Channel</th>
            <th>Available</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {CHANNELS.map((c) => (
            <tr key={c.channel}>
              <td className="text-text">{c.channel}</td>
              <td className="tabular">{c.qty}</td>
              <td className="text-text-secondary">{c.note}</td>
            </tr>
          ))}
        </tbody>
      </SimpleTable>
      <div className="flex items-center gap-2 border-t border-border bg-surface-subdued px-4 py-2.5 text-[12px] text-text-secondary">
        <span className="h-2 w-2 rounded-full bg-accent" />
        Strato: this family sells 22 a month; the reorder of 40 is drafted against the 9-week lead time.
      </div>
    </div>
  );
}

export default function AutomotivePage() {
  return (
    <>
      <PageHero title="Built for every channel at once." body="Aftermarket brands live or die on stock accuracy across the web store, the counter and the dealer network. cumulusOS is the one count all of them read." secondary={{ href: "/connect", label: "See integrations" }}>
        <Reveal className="mt-14 grid gap-8 md:mt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center">
          <CheckList size="lg" items={["Thousands of SKUs by fitment and finish, each with a barcode.", "Web store, register and dealer orders on one count that never oversells.", "Containers received at landed cost on the day they arrived.", "Returns inspected and restocked in the same ledger as the sale."]} />
          <ChannelCard />
        </Reveal>
      </PageHero>

      <section className="border-b border-border">
        <div className={`${container} py-20 md:py-28`}>
          <SectionTitle title="Four problems every brand tells us about." body="And what each one looks like once there is a single count." />
          <div className="mt-12">
            <PainPoints items={PAINS} />
          </div>
        </div>
      </section>

      <section className="bg-surface">
        <div className={`${container} py-20 md:py-28`}>
          <SectionTitle title="What aftermarket brands lean on." />
          <FeatureGrid items={FEATURES} columns={3} className="mt-14" />
        </div>
      </section>

      <CtaBand title="Bring your catalog export. We will import it live." body="Thirty minutes with the founders, from the store export to a synced count." />
    </>
  );
}
