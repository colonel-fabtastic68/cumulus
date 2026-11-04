import type { Metadata } from "next";
import { Flag, Hammer, QrCode, ShoppingCart, Timer, Truck } from "lucide-react";
import { BuildSheet } from "@/components/marketing/BuildSheet";
import { Reveal } from "@/components/marketing/Reveal";
import { CheckList, CtaBand, FeatureGrid, PageHero, PainPoints, SectionTitle, container } from "@/components/marketing/shared";

export const metadata: Metadata = {
  title: "Motorsport · cumulusOS",
  description: "Inventory for chassis builders, race teams and performance parts makers: builds that consume multi-level BOMs, heat-number traceability, trailer transfers for race weekends and customer builds, with Strato drafting the bulk work.",
};

const PAINS = [
  { pain: "A chassis build pulls from forty bins and nobody knows what is short until the welder stops.", fix: "The build sheet shows what is short before anyone picks a tube.", detail: "Builds explode the BOM down through sub-assemblies, reserve what is on hand, and list the shortfall with the supplier and lead time. Strato drafts the PO; you approve it." },
  { pain: "A customer asks for material certs on a car you delivered eighteen months ago.", fix: "Every tube and casting keeps its heat or lot number from receipt to the finished car.", detail: "Lots are allocated to builds as they are consumed, so any car traces back to the heats that went into it, and any heat traces forward to the cars it is in." },
  { pain: "The trailer leaves Thursday with whatever someone remembered to pack.", fix: "Par levels per trailer and a transfer that moves stock there and back.", detail: "Each hauler is a location with its own min and max. A transfer picks the shortfall, the count in the paddock matches the shop's, and what comes home is booked back in." },
  { pain: "Every customer car is a one-off, and the quote, the build and the invoice never agree.", fix: "Quotes become builds, builds become shipments, and the customer's car keeps its own list.", detail: "Price groups per customer, custom fields for the spec, and a build record that shows exactly what went into their car and what it cost you." },
];

const FEATURES = [
  { icon: Hammer, title: "Builds that eat the BOM", body: "Tubes, brackets, fasteners and sub-assemblies consumed in one build with scrap allowances per line." },
  { icon: Flag, title: "Heat numbers and certs", body: "Lot and heat numbers from receipt through every build, forward and backward." },
  { icon: Truck, title: "Shop, trailer and track", body: "Transfers and par levels per hauler, with phone scanning in the paddock." },
  { icon: Timer, title: "Lead times that matter", body: "Supplier lead times feed the build schedule, so the long-lead rod ends are ordered first." },
  { icon: QrCode, title: "Labels on everything", body: "QR labels for bins, racks, lots and finished assemblies, printed on any sheet from Exports." },
  { icon: ShoppingCart, title: "Parts sales alongside builds", body: "Sell spares online or at the counter from the same stock the builds use. Nothing oversells." },
];

export default function MotorsportPage() {
  return (
    <>
      <PageHero title="From tube rack to finish line." body="Chassis builders, race teams and performance parts makers run on tight timelines and tighter traceability. cumulusOS keeps the count honest while the shop keeps moving." secondary={{ href: "/product", label: "See the product" }}>
        <Reveal className="mt-14 grid gap-8 md:mt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-center">
          <CheckList size="lg" items={["Builds reserve stock and show what is short before the welder stops.", "Heat and lot numbers travel from the receiving dock to the delivered car.", "Race-weekend transfers to the trailer and back, with a count that matches the paddock.", "Strato drafts the PO, the cycle count and the price update; a human approves."]} />
          <BuildSheet className="shadow-[var(--shadow-bevel),var(--shadow-400)]" />
        </Reveal>
      </PageHero>

      <section className="border-b border-border">
        <div className={`${container} py-20 md:py-28`}>
          <SectionTitle title="Four problems every shop tells us about." body="And what each one looks like once the ledger is in charge." />
          <div className="mt-12">
            <PainPoints items={PAINS} />
          </div>
        </div>
      </section>

      <section className="bg-surface">
        <div className={`${container} py-20 md:py-28`}>
          <SectionTitle title="What motorsport shops lean on." />
          <FeatureGrid items={FEATURES} columns={3} className="mt-14" />
        </div>
      </section>

      <CtaBand title="Bring a BOM. We will build it live." body="Thirty minutes with the founders on your own parts list, from the tube rack to the finished car." />
    </>
  );
}
