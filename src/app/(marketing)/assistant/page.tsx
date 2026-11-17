import type { Metadata } from "next";
import { ArrowRight, ClipboardList, Cpu, Eye, Hammer, History, Layers, Mail, PackageCheck, Phone, RotateCcw, ShoppingCart, Store, Truck, UserCheck } from "lucide-react";
import { Button } from "@/components/ui";
import { Reveal } from "@/components/marketing/Reveal";
import { StratoOrderPreview } from "@/components/marketing/StratoOrderPreview";
import { CheckList, CtaBand, FeatureGrid, SectionTitle, container } from "@/components/marketing/shared";

export const metadata: Metadata = {
  title: "Strato · cumulusOS",
  description: "Strato is the assistant inside cumulusOS for running orders: it enters the order, checks stock against the BOM, drafts purchase orders for what is short and lines up the build and the shipment. A person approves every change, and your own assistants can connect over MCP.",
};

/** One order, in the sequence it moves through the shop. Each step is a tool Strato already has. */
const ORDER_FLOW = [
  { icon: ClipboardList, title: "Enter the order", body: "Give Strato the request in plain words, or the customer's own message. It matches each line to your catalog and drafts the sales order with quantities and prices." },
  { icon: Layers, title: "Check stock before you promise", body: "It explodes the BOM against what is on the shelf and lists what is short, down through the sub-assemblies." },
  { icon: Truck, title: "Draft the purchase orders", body: "Shortages and reorder points become draft purchase orders, one per supplier at that supplier's last cost. New lines join an open draft instead of raising a second order." },
  { icon: Hammer, title: "Build what the order needs", body: "A build takes its components out through the ledger and puts the finished unit on the shelf with its cost." },
  { icon: PackageCheck, title: "Ship and receive", body: "Open orders ship by number and relieve stock. Deliveries are booked against their purchase order, with the lot and the cost kept." },
  { icon: RotateCcw, title: "Handle the return", body: "A return opens as an RMA and ends in a restock or a write-off, with the reason on the line." },
];

/** How orders reach the workspace. Email and phone are behind the connectors preview flag: only messages added by hand are read today. */
const CHANNELS = [
  { icon: ShoppingCart, name: "Web store", status: "Live", live: true, body: "Shopify and WooCommerce orders arrive within seconds of the sale and pull from the same count as every other channel." },
  { icon: Store, name: "Counter", status: "Live", live: true, body: "Sales at the Square register relieve the same stock the web store sells." },
  { icon: Mail, name: "Email", status: "In preview", live: false, body: "Add an emailed order and it is read into lines matched to your catalog, then opened as a draft for you to check. Inboxes that connect directly are next." },
  { icon: Phone, name: "Phone", status: "In preview", live: false, body: "Notes from a call are read into a draft order the same way. A phone line that takes the order itself is next." },
];

const CONTROL = [
  { icon: Eye, title: "See it before it lands", body: "Strato looks things up on its own. Anything that changes stock, an order or a price waits as a proposal, shown in your own tables with current next to proposed." },
  { icon: UserCheck, title: "Your roles decide who signs off", body: "A change waits for you, or for a teammate whose role allows it. Everyone else can ask and review." },
  { icon: History, title: "A name on every change", body: "What gets applied is a movement in the ledger and an entry in the activity log, with who approved it." },
  { icon: Cpu, title: "AI under the hood, for the heavy lifting", body: "Reading a supplier's PDF, matching forty part numbers or drafting a long order runs on a large language model, Google Gemini. It drafts and your team decides. On-hand and cost figures always come from the ledger, never from the model." },
];

const MCP_FACTS = [
  { term: "Protocol", detail: "Model Context Protocol, over HTTP" },
  { term: "Works with", detail: "Claude, Cursor and other MCP clients, or an agent your team built" },
  { term: "Tools", detail: "The same set Strato uses" },
  { term: "Access", detail: "Behind a token you set" },
];

export default function StratoPage() {
  return (
    <>
      <section className="border-b border-border">
        <div className={`${container} grid items-center gap-10 py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:gap-16 lg:py-14`}>
          <div>
            <h1 className="hero hero-compact hero-in">
              Strato works the order. <span className="text-brand-red">You approve it.</span>
            </h1>
            <p className="lede hero-in mt-4" style={{ animationDelay: "80ms" }}>
              Strato is the assistant built into cumulusOS. It enters the order, checks stock against the BOM, drafts the purchase order for what is short and lines up the build and the shipment. Nothing is written until a person approves it.
            </p>
            <div className="hero-in mt-6 flex flex-wrap items-center gap-2" style={{ animationDelay: "160ms" }}>
              <Button variant="primary" size="lg" href="/#demo" iconRight={<ArrowRight />}>
                Book a demo
              </Button>
              <Button size="lg" href="/connect">
                See integrations
              </Button>
            </div>
          </div>
          <div className="hero-in mx-auto w-full max-w-[480px] lg:max-w-none" style={{ animationDelay: "120ms" }}>
            <StratoOrderPreview />
          </div>
        </div>
      </section>

      <section id="orders" className="scroll-mt-16 bg-surface">
        <div className={`${container} py-14 md:py-20`}>
          <SectionTitle title="From the request to the truck." body="Strato is a set of tools for running orders, not another dashboard about them. Each step below is work it drafts or does inside cumulusOS, in the same ledger your team uses." />
          <FeatureGrid items={ORDER_FLOW} columns={3} className="mt-10" />
        </div>
      </section>

      <section id="channels" className="scroll-mt-16 border-t border-border">
        <div className={`${container} py-14 md:py-20`}>
          <SectionTitle title="However the order arrives." body="Store and counter orders come in through the integrations. Orders that arrive as an email or a phone call are in preview." />
          <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CHANNELS.map(({ icon: Icon, name, status, live, body }, i) => (
              <Reveal key={name} delay={i * 50}>
                <li className="flex h-full flex-col rounded-[var(--radius)] bg-surface p-5 shadow-[var(--shadow-bevel)]">
                  <div className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4 shrink-0 text-icon" />
                    <h3 className="text-[15px] font-semibold text-text">{name}</h3>
                    <span className={`ml-auto rounded-full px-2 py-0.5 text-[12px] font-medium ${live ? "bg-success-soft text-success" : "bg-surface-subdued text-text-secondary"}`}>{status}</span>
                  </div>
                  <p className="mt-3 text-[13.5px] leading-6 text-text-secondary">{body}</p>
                </li>
              </Reveal>
            ))}
          </ul>
          <Button variant="plain" href="/connect" iconRight={<ArrowRight />} className="mt-8">
            Every integration and what it does
          </Button>
        </div>
      </section>

      <section id="approval" className="scroll-mt-16 border-t border-border bg-surface">
        <div className={`${container} grid gap-10 py-14 md:py-20 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12`}>
          <SectionTitle title="Nothing is written until a person approves." body="Strato does the reading, the matching and the drafting. The decision stays with the people who run the shop." />
          <FeatureGrid items={CONTROL} />
        </div>
      </section>

      <section id="mcp" className="scroll-mt-16 border-t border-border">
        <div className={`${container} grid items-center gap-10 py-14 md:py-20 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-12`}>
          <Reveal>
            <h2 className="display">Bring the assistant you already use.</h2>
            <p className="lede mt-4">cumulusOS speaks the Model Context Protocol (MCP), an open standard for connecting assistants to business software. Claude, Cursor or an agent your team built can read the workspace and use the same tools Strato does.</p>
            <CheckList className="mt-6" items={["Answers come from the same ledger your team sees, not a copy of it.", "Access sits behind a token you set.", "Anything an outside assistant changes is named in the activity log."]} />
          </Reveal>
          <Reveal delay={100}>
            <dl className="rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-bevel),var(--shadow-card)]">
              {MCP_FACTS.map(({ term, detail }) => (
                <div key={term} className="grid grid-cols-[96px_minmax(0,1fr)] gap-4 border-b border-border px-5 py-3 text-[13.5px] leading-6 last:border-b-0">
                  <dt className="text-text-secondary">{term}</dt>
                  <dd className="font-medium text-text">{detail}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </section>

      <CtaBand title="Bring a real order to the demo." body="We enter it, check stock, draft the purchase order and ship it, in a workspace with your own parts. Thirty minutes, no slides." />
    </>
  );
}
