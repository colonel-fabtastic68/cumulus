import type { Metadata } from "next";
import { Barcode, Boxes, CalendarRange, ClipboardList, FileSpreadsheet, FileText, Hammer, Layers, PackageCheck, Plug, RotateCcw, Scale, ShoppingCart, Timer, Truck, Users } from "lucide-react";
import { ProductPreview } from "@/components/marketing/ProductPreview";
import { Reveal } from "@/components/marketing/Reveal";
import { StratoPreview } from "@/components/marketing/StratoPreview";
import { CtaBand, FeatureGrid, PageHero, SectionTitle, container } from "@/components/marketing/shared";

export const metadata: Metadata = {
  title: "Product · cumulusOS",
  description: "Every part of cumulusOS: ledger-true stock, multi-level BOMs and builds, lots and traceability, receiving, orders, returns, replenishment, labels, imports and Strato, the agent that drafts the bulk work for your approval.",
};

const CORE = [
  { icon: Scale, title: "Ledger-true stock", body: "Every change is a movement with the balance after it. Nothing edits on-hand directly, so the count on screen is the count on the shelf." },
  { icon: Layers, title: "BOMs within BOMs", body: "Assemblies pull sub-assemblies from stock or explode down to base parts, with expected scrap built into the requirement." },
  { icon: Hammer, title: "Builds and work orders", body: "Start a build, see what is short and who supplies it, consume the components and put the finished unit on the shelf with its cost." },
  { icon: PackageCheck, title: "Receiving and back-dating", body: "Book deliveries against purchase orders on the day they really arrived. Lots keep their cost, so valuation stays honest." },
  { icon: Timer, title: "Lots, heat numbers and FIFO", body: "Batches carry their lot or heat number, expiry and cost. The oldest leave first, and any finished unit traces back to what went in." },
  { icon: CalendarRange, title: "Replenishment that forecasts", body: "Reorder points, days of cover and demand curves turn into a purchase plan. Merge suggestions into one PO per supplier and receive them together." },
  { icon: ShoppingCart, title: "Orders, quotes and shipping", body: "Quotes become orders, orders reserve stock, partial shipments and backorders track per line, and labels buy through Shippo or EasyPost." },
  { icon: RotateCcw, title: "Returns and write-offs", body: "RMAs move through inspection to restock or write-off, in the same ledger as sales and builds, with the reason on every line." },
  { icon: Truck, title: "Suppliers and lead times", body: "Each supplier carries its lead time, terms and the parts it covers, so reorders land before the line stops." },
  { icon: Barcode, title: "Labels and scanning", body: "QR and barcode labels for items, lots, locations, suppliers and assemblies on any sheet size. Scan with a phone to open the record or count." },
  { icon: FileSpreadsheet, title: "Imports that explain themselves", body: "Map any export, paste a list, or photograph a count sheet. Strato reads it, fills the gaps you allow, and the review shows every change first." },
  { icon: FileText, title: "Documents and exports", body: "Label sheets, pick lists and reports save to Documents. Exports go out as CSV or PDF, in the shape your accountant asked for." },
  { icon: Boxes, title: "Locations and transfers", body: "Bins, shelves, trailers and warehouses, with transfers between them and par levels for each." },
  { icon: Users, title: "Live for the whole team", body: "Owners, admins, members and viewers work on the same data in the browser, with presence, an activity log and a shared calendar." },
  { icon: Plug, title: "Integrations and MCP", body: "Shopify, WooCommerce, Square, Clover, QuickBooks, Shippo and EasyPost connect in a few clicks. Other agents reach every Strato tool over MCP." },
  { icon: ClipboardList, title: "Reports from the movements", body: "Low stock, valuation by category, shelf life, build cost and return rate, all computed from the ledger, never from a cached total." },
];

const STRATO_POINTS = [
  { title: "Plain language in, one proposal out", body: "A dozen price changes is one approval, not twelve. Per-item values, percentages and filters all fit in a single request." },
  { title: "Preview in the table", body: "Proposed rows turn orange in your inventory. Flip between current and proposed values, then apply from either side." },
  { title: "Reads run, writes wait", body: "Strato looks things up on its own. Anything that changes data waits for you, or for a teammate whose role allows it." },
  { title: "Paper and PDFs too", body: "Photograph a count sheet or drop in a supplier's PDF. Strato turns it into rows, flags what it could not read, and fills the gaps you allow." },
];

export default function ProductPage() {
  return (
    <>
      <PageHero title="The whole shop, one ledger." body="Parts, BOMs, builds, receiving, orders, returns and replenishment in a browser, with Strato drafting the bulk changes and waiting for your approval. Click around the live preview below." secondary={{ href: "/connect", label: "See integrations" }}>
        <Reveal className="mt-14 md:mt-16">
          <ProductPreview className="shadow-[var(--shadow-bevel),var(--shadow-400)]" />
        </Reveal>
      </PageHero>

      <section id="features" className="scroll-mt-16">
        <div className={`${container} py-20 md:py-28`}>
          <SectionTitle title="Built for the way parts actually move." body="Every number comes from a movement in the ledger, so what you see is what is on the shelf, in the trailer or on the truck." />
          <FeatureGrid items={CORE} columns={3} className="mt-14" />
        </div>
      </section>

      <section id="strato" className="scroll-mt-16 border-t border-border bg-surface">
        <div className={`${container} grid items-center gap-12 py-20 md:py-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16`}>
          <Reveal>
            <h2 className="display">Ask for the change. Approve it once.</h2>
            <p className="lede mt-4">Strato reads your items, BOMs and movements, drafts the change, and shows it in the table before anything is written.</p>
            <ul className="mt-8 flex flex-col gap-5">
              {STRATO_POINTS.map((p) => (
                <li key={p.title} className="border-l-2 border-brand-red pl-4">
                  <h3 className="text-[15px] font-semibold text-text">{p.title}</h3>
                  <p className="mt-1 text-[14px] leading-6 text-text-secondary">{p.body}</p>
                </li>
              ))}
            </ul>
            <p className="mt-8 text-[13px] text-text-tertiary">Runs on Google Gemini. Other agents can use the same tools over MCP, behind a token you set.</p>
          </Reveal>
          <Reveal delay={100}>
            <StratoPreview />
          </Reveal>
        </div>
      </section>

      <CtaBand title="See it on your own parts." body="Thirty minutes with the founders, on a spreadsheet or export you bring. No slides." secondary={{ href: "/demo", label: "Try the sample workspace" }} />
    </>
  );
}
