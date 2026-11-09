import { ArrowRight, Flag, Hammer, Layers, PackageCheck, RotateCcw, Store, Truck, Wrench } from "lucide-react";
import { Button } from "@/components/ui";
import type { RuntimeConfig } from "@/lib/firebase-config";
import { InquiryForm } from "./InquiryForm";
import { Reveal } from "./Reveal";
import { SessionCta } from "./SessionCta";
import { WasteCalculator } from "./WasteCalculator";
import { CheckList, FeatureGrid, SectionTitle, container } from "./shared";

/** The hero: copy on the left, the waste calculator on a red slab on the right (a red band under the copy on phones). */
export function Hero({ runtimeConfig }: { runtimeConfig: RuntimeConfig }) {
  return (
    <section className="hero-ground relative overflow-hidden border-b border-border">
      <span aria-hidden className="hero-slab absolute inset-y-0 hidden lg:block" />
      <div className={`${container} relative grid items-center gap-10 pt-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-14 lg:py-16`}>
        <div>
          <h1 className="hero hero-in">
            Built for the people who <span className="text-brand-red">build the cars.</span>
          </h1>
          <p className="lede hero-in mt-5" style={{ animationDelay: "80ms" }}>
            cumulusOS runs parts, BOMs, builds, receiving and orders for chassis shops, race teams and aftermarket brands, with Strato drafting the bulk work for your approval.
          </p>
          <CheckList className="hero-in mt-6" size="lg" items={[<><strong className="font-semibold text-text">Every part traced</strong> to its lot, heat number and build.</>, <><strong className="font-semibold text-text">Store, counter and accounting in sync</strong>, so stock is never oversold.</>, <><strong className="font-semibold text-text">Live for the whole shop in an afternoon</strong>, from the spreadsheet you have.</>]} />
          <div className="hero-in mt-7" style={{ animationDelay: "160ms" }}>
            <SessionCta runtimeConfig={runtimeConfig} placement="hero" />
          </div>
        </div>
        <div className="-mx-6 bg-brand-red px-4 py-8 sm:px-6 lg:mx-0 lg:bg-transparent lg:p-0">
          <div className="mx-auto max-w-[480px] lg:max-w-none">
            <WasteCalculator />
          </div>
        </div>
      </div>
    </section>
  );
}

const MOTORSPORT = [
  { icon: Hammer, title: "Builds that eat the BOM", body: "A chassis or a race-ready car pulls tubes, brackets, fasteners and sub-assemblies from stock in one build, with scrap allowances built in." },
  { icon: Flag, title: "Heat numbers and lot traceability", body: "Every tube and casting keeps its heat or lot number from receipt to the finished car, so a cert request or a recall takes minutes." },
  { icon: Truck, title: "Shop to trailer and back", body: "Transfers move spares to the hauler for a race weekend and back again, with par levels per trailer and a count that matches the paddock." },
  { icon: Wrench, title: "One-off and customer builds", body: "Quotes become builds, builds become shipments, and each customer's car carries its own list of what went into it." },
];

export function MotorsportSection() {
  return (
    <section id="motorsport" className="scroll-mt-16 border-t border-border bg-surface">
      <div className={`${container} grid gap-12 py-20 md:py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16`}>
        <SectionTitle title="From tube rack to finish line." body="Chassis builders, race teams and performance parts makers run on tight timelines and tighter traceability. cumulusOS keeps the count honest while the shop keeps moving." />
        <div>
          <FeatureGrid items={MOTORSPORT} />
          <Button variant="plain" href="/motorsport" iconRight={<ArrowRight />} className="mt-8">
            How motorsport shops use cumulusOS
          </Button>
        </div>
      </div>
    </section>
  );
}

const AUTOMOTIVE = [
  { icon: Layers, title: "Thousands of SKUs, by fitment and finish", body: "Wheels, suspension, exhaust and lighting in every size, offset and color, with custom fields for fitment and a barcode on each one." },
  { icon: Store, title: "Online, counter and wholesale in one count", body: "Shopify or WooCommerce, the Square register and dealer orders all pull from the same stock, so no channel oversells another." },
  { icon: PackageCheck, title: "Containers received the day they landed", body: "Back-dated receiving with landed cost per lot, FIFO or average, so margins hold up when freight changes." },
  { icon: RotateCcw, title: "Fitment returns handled, not argued", body: "RMAs move through inspection to restock or write-off with the reason on each line, and the ledger shows the real return rate per SKU." },
];

export function AutomotiveSection() {
  return (
    <section id="automotive" className="scroll-mt-16 border-t border-border">
      <div className={`${container} grid gap-12 py-20 md:py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16`}>
        <SectionTitle title="One count for every channel." body="Aftermarket brands live or die on stock accuracy across the web store, the counter and the dealer network. cumulusOS is the one count all of them read." />
        <div>
          <FeatureGrid items={AUTOMOTIVE} />
          <Button variant="plain" href="/automotive" iconRight={<ArrowRight />} className="mt-8">
            How aftermarket brands use cumulusOS
          </Button>
        </div>
      </div>
    </section>
  );
}

export function OtherIndustries() {
  return (
    <section id="contact" className="scroll-mt-16 border-t border-border bg-surface">
      <div className={`${container} grid gap-12 py-20 md:py-24 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16`}>
        <Reveal>
          <h2 className="display">Not in vehicles? Let us have a look.</h2>
          <p className="lede mt-4">cumulusOS already runs a ranch store, an audio builder and a few shops that have nothing to do with cars. Tell us what you stock and what breaks, and we will tell you honestly whether it fits.</p>
          <CheckList className="mt-8" items={["Any product business with parts, assemblies, lots or multiple sales channels.", "A reply from a founder, usually the same business day.", "If it is a fit, a call to see it on your own data."]} />
        </Reveal>
        <Reveal delay={100}>
          <div className="rounded-[var(--radius-lg)] bg-bg p-6 shadow-[var(--shadow-bevel),var(--shadow-card)] md:p-8">
            <h3 className="display-sm">Book a call about your inventory</h3>
            <p className="mt-2 text-[14px] leading-6 text-text-secondary">A few lines is plenty. We come back with questions and a time.</p>
            <div className="mt-6">
              <InquiryForm submitLabel="Send and book a call" />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const STEPS = [
  { title: "Book thirty minutes", body: "Bring a spreadsheet, an export from your store or accounting, or a few part numbers. We show cumulusOS on them, not on a sample." },
  { title: "Import the data you already have", body: "Columns map themselves, unknown ones become custom fields, and Strato reads paper count sheets and PDFs too. The review shows every change before it lands." },
  { title: "Connect the store, the register and the books", body: "Shopify, WooCommerce, Square, Clover and QuickBooks plug in under Integrations. Stock levels push out, orders come in, and webhooks keep both sides live." },
  { title: "Invite the shop and hand Strato the bulk work", body: "Teammates sign in with an emailed link and see the same numbers live. Price updates, counts and reorders become one request and one approval." },
];

/** The page's one dark band: brand black with a red edge, four numbered steps. */
export function Steps() {
  return (
    <section id="steps" className="relative scroll-mt-16 overflow-hidden bg-brand-black text-band-text">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-brand-red" />
      <div className={`${container} py-20 md:py-28`}>
        <Reveal className="mx-auto flex max-w-[720px] flex-col items-center text-center">
          <h2 className="display text-band-text">Spreadsheet to live shop floor in an afternoon.</h2>
          <p className="mt-4 max-w-[34em] text-[15px] leading-6 text-band-text-secondary">Onboarding starts with your own data, not a tutorial, and we do the first import with you.</p>
        </Reveal>
        <ol className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map(({ title, body }, i) => (
            <Reveal key={title} delay={i * 70}>
              <li className="flex h-full flex-col rounded-[var(--radius-lg)] border border-band-border bg-white/[0.04] p-6">
                <span aria-hidden className="race-number text-[44px] text-brand-red">
                  0{i + 1}
                </span>
                <h3 className="mt-5 text-[16.5px] font-semibold leading-6 text-band-text">{title}</h3>
                <p className="mt-2 text-[14px] leading-6 text-band-text-secondary">{body}</p>
              </li>
            </Reveal>
          ))}
        </ol>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
          <Button size="lg" href="/#demo" iconRight={<ArrowRight />} className="bg-white text-text hover:bg-white/90">
            Book a demo
          </Button>
          <Button size="lg" variant="tertiary" href="/product" className="text-band-text! hover:bg-white/10!">
            See every feature
          </Button>
        </div>
      </div>
    </section>
  );
}
