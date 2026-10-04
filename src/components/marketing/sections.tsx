import { CalendarRange, Check, FileSpreadsheet, GitFork, Layers, PackageCheck, Plug, RotateCcw, Scale, Timer, Users } from "lucide-react";
import type { RuntimeConfig } from "@/lib/firebase-config";
import { StratoPreview } from "./StratoPreview";
import { ProductPreview } from "./ProductPreview";
import { Reveal } from "./Reveal";
import { BrandMark, type BrandId } from "./IntegrationLogos";
import { SessionCta } from "./SessionCta";
import { WaitlistForm } from "./WaitlistForm";

const container = "mx-auto w-full max-w-[1120px] px-6";

export function Hero({ runtimeConfig }: { runtimeConfig: RuntimeConfig }) {
  return (
    <section id="product" className={`${container} pt-16 pb-12 md:pt-24 md:pb-16`}>
      <div className="max-w-[760px]">
        <h1 className="hero-in text-[38px] font-semibold leading-[1.05] tracking-[-0.025em] text-text sm:text-[52px] md:text-[64px]">Inventory that keeps up with your team.</h1>
        <p className="hero-in mt-6 max-w-[600px] text-[17px] leading-7 text-text-secondary md:text-[19px] md:leading-8" style={{ animationDelay: "80ms" }}>
          cumulusOS tracks parts, BOMs, receiving and returns in one live workspace, and Strato makes the bulk changes you approve.
        </p>
        <div className="hero-in mt-8" style={{ animationDelay: "160ms" }}>
          <SessionCta runtimeConfig={runtimeConfig} placement="hero" />
        </div>
        <p className="hero-in mt-5 text-[13.5px] text-text-tertiary" style={{ animationDelay: "240ms" }}>
          Onboarding a few teams at a time, each with a workspace built around their own stock.
        </p>
      </div>
      <Reveal className="mt-14 md:mt-20">
        <ProductPreview className="shadow-[var(--shadow-bevel),var(--shadow-400)]" />
      </Reveal>
    </section>
  );
}

const FEATURES = [
  { icon: Scale, title: "Ledger-true stock", body: "Every change is a movement with the balance after it. Nothing edits on-hand directly, so the count on screen is the count on the shelf." },
  { icon: Layers, title: "BOMs within BOMs", body: "Assemblies pull sub-assemblies from stock or explode down to base parts, with expected waste built into the requirement." },
  { icon: PackageCheck, title: "Receiving and back-dating", body: "Book deliveries against suppliers with the date they really arrived. Lots keep their cost, so valuation stays honest." },
  { icon: Timer, title: "Shelf life and FIFO lots", body: "Batches carry their expiry, the oldest leave first, and the shelf-life report shows what to move before it goes to waste." },
  { icon: RotateCcw, title: "Returns and write-offs", body: "RMAs, inspections and write-offs land in the same ledger as sales and builds, with the reason on each line." },
  { icon: CalendarRange, title: "Min, max and seasonality", body: "Reorder points, days of cover and monthly demand curves tell you what to order next and when." },
  { icon: FileSpreadsheet, title: "Imports that explain themselves", body: "Map any export, create custom fields on the fly, and review exactly which fields change before a row lands." },
  { icon: Users, title: "Live for the whole team", body: "Owners, admins, members and viewers work on the same data in the browser, with presence and an activity log." },
];

export function Features() {
  return (
    <section id="features" className="scroll-mt-16 border-t border-border bg-surface">
      <div className={`${container} py-20 md:py-28`}>
        <Reveal className="max-w-[640px]">
          <h2 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] text-text md:text-[40px]">Built for the way stock actually moves.</h2>
          <p className="mt-4 text-[16px] leading-7 text-text-secondary md:text-[17px]">Every number comes from a ledger, so what you see is what is on the shelf.</p>
        </Reveal>
        <ul className="mt-14 grid gap-x-12 gap-y-10 md:grid-cols-2">
          {FEATURES.map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={(i % 2) * 60}>
              <li className="flex gap-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-subdued text-icon shadow-[var(--shadow-bevel)]">
                  <Icon className="h-4 w-4" />
                </span>
                <div>
                  <h3 className="text-[15.5px] font-semibold text-text">{title}</h3>
                  <p className="mt-1 text-[14px] leading-6 text-text-secondary">{body}</p>
                </div>
              </li>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

const STRATO_POINTS = [
  { title: "Plain language in, one proposal out", body: "A dozen price changes is one approval, not twelve. Per-item values, percentages and filters all fit in a single call." },
  { title: "Preview in the table", body: "Proposed rows turn orange in your inventory. Flip between current and proposed values, then apply from either side." },
  { title: "Reads run, writes wait", body: "Strato looks things up on its own. Anything that changes data waits for you, or for a teammate whose role allows it." },
];

export function StratoSection() {
  return (
    <section id="strato" className="scroll-mt-16 border-t border-border">
      <div className={`${container} grid items-center gap-12 py-20 md:py-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16`}>
        <Reveal>
          <div className="text-[12px] font-[550] uppercase tracking-[0.08em] text-text-tertiary">Strato</div>
          <h2 className="mt-3 text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] text-text md:text-[40px]">Ask for the change. Approve it once.</h2>
          <p className="mt-4 text-[16px] leading-7 text-text-secondary md:text-[17px]">Strato reads your items, BOMs and movements, drafts the change, and shows it in the table before anything is written.</p>
          <ul className="mt-8 flex flex-col gap-5">
            {STRATO_POINTS.map((p) => (
              <li key={p.title} className="border-l-2 border-border pl-4">
                <h3 className="text-[15px] font-semibold text-text">{p.title}</h3>
                <p className="mt-1 text-[14px] leading-6 text-text-secondary">{p.body}</p>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-[13px] text-text-tertiary">Runs on Gemini Flash with your own API key. Other agents can use the same tools over MCP.</p>
        </Reveal>
        <Reveal delay={100}>
          <StratoPreview />
        </Reveal>
      </div>
    </section>
  );
}

const CONNECTIONS: Array<{ id: BrandId; name: string; body: string }> = [
  { id: "shopify", name: "Shopify", body: "Products and orders come in, stock levels and edits go out, and webhooks keep both sides live." },
  { id: "woocommerce", name: "WooCommerce", body: "The same two-way sync for WordPress stores: categories, prices and status pushed, orders pulled." },
  { id: "square", name: "Square", body: "The item library comes in by SKU, with in-store counts as opening quantities when you want them." },
  { id: "clover", name: "Clover", body: "Inventory, prices and product codes from the register, matched by SKU, synced nightly." },
  { id: "quickbooks", name: "QuickBooks Online", body: "Products and services in by SKU with sales price, purchase cost and reorder point." },
  { id: "shippo", name: "Shippo", body: "Rates, labels and tracking for every carrier on your Shippo account when you ship an order." },
  { id: "easypost", name: "EasyPost", body: "Rate-shop the carriers on your account, buy the label and follow the parcel to the door." },
];

export function Integrations() {
  return (
    <section id="integrations" className="scroll-mt-16 border-t border-border bg-surface">
      <div className={`${container} py-20 md:py-24`}>
        <Reveal className="max-w-[640px]">
          <h2 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] text-text md:text-[40px]">Connects to what you already run.</h2>
          <p className="mt-4 text-[16px] leading-7 text-text-secondary md:text-[17px]">Stores, registers, accounting and carriers plug in under Integrations. Credentials are checked with the platform and kept on the server, never in the browser.</p>
        </Reveal>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CONNECTIONS.map((c, i) => (
            <Reveal key={c.id} delay={(i % 4) * 50}>
              <div className="flex h-full flex-col rounded-[var(--radius)] bg-bg p-5 shadow-[var(--shadow-bevel)]">
                <div className="flex items-center gap-3">
                  <BrandMark id={c.id} size={28} />
                  <h3 className="text-[15px] font-semibold text-text">{c.name}</h3>
                </div>
                <p className="mt-3 text-[13.5px] leading-6 text-text-secondary">{c.body}</p>
              </div>
            </Reveal>
          ))}
          <Reveal delay={150}>
            <div className="flex h-full flex-col justify-center gap-3 rounded-[var(--radius)] border border-dashed border-border p-5">
              <p className="flex items-start gap-3 text-[13.5px] leading-6 text-text-secondary">
                <FileSpreadsheet className="mt-1 h-4 w-4 shrink-0 text-icon" />
                Any spreadsheet imports: columns map themselves and unknown ones become custom fields.
              </p>
              <p className="flex items-start gap-3 text-[13.5px] leading-6 text-text-secondary">
                <Plug className="mt-1 h-4 w-4 shrink-0 text-icon" />
                Other agents reach every Strato tool over MCP, behind a token you set.
              </p>
            </div>
          </Reveal>
        </div>
        <p className="mt-6 text-[12.5px] text-text-tertiary">Brand names and marks belong to their owners and appear only to show that the connection exists.</p>
      </div>
    </section>
  );
}

const STEPS = [
  { icon: FileSpreadsheet, title: "Import the sheet you already have", body: "Paste or upload. Columns map themselves, custom fields are one click, and the review shows what changes before it lands." },
  { icon: Users, title: "Invite the team", body: "Send each teammate an email invite. They sign in with a password or an emailed link, and everyone sees the same numbers live." },
  { icon: GitFork, title: "Hand the bulk work to Strato", body: "Price updates, cycle counts, receiving, BOM edits. One request, one approval, and the ledger records who did what." },
];

export function PilotSteps() {
  return (
    <section id="pilot" className="scroll-mt-16 border-t border-border">
      <div className={`${container} grid gap-10 py-20 md:py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16`}>
        <Reveal>
          <h2 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] text-text md:text-[40px]">From spreadsheet to live workspace in an afternoon.</h2>
          <p className="mt-4 text-[16px] leading-7 text-text-secondary md:text-[17px]">Onboarding starts with your own data, not a tutorial.</p>
        </Reveal>
        <ol className="flex flex-col">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={i * 70}>
              <li className="flex gap-5 border-t border-border py-7 first:border-t-0 first:pt-0">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-surface text-icon shadow-[var(--shadow-bevel)]">
                  <Icon className="h-4.5 w-4.5" />
                </span>
                <div>
                  <h3 className="text-[17px] font-semibold text-text">{title}</h3>
                  <p className="mt-1.5 text-[14.5px] leading-6 text-text-secondary">{body}</p>
                </div>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

const WAITLIST_POINTS = [
  "Tell us what you make, sell and ship, and what you track it in today.",
  "We set up a workspace around it, import your data with you, and connect the stores, registers and carriers you use.",
  "You get a system that fits your business, and a direct line to the people building it.",
];

export function Waitlist() {
  return (
    <section id="waitlist" className="scroll-mt-16 border-t border-border bg-surface">
      <div className={`${container} grid gap-12 py-20 md:py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16`}>
        <Reveal>
          <div className="text-[12px] font-[550] uppercase tracking-[0.08em] text-text-tertiary">Waitlist</div>
          <h2 className="mt-3 text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] text-text md:text-[40px]">Built around your stock, not a template.</h2>
          <p className="mt-4 text-[16px] leading-7 text-text-secondary md:text-[17px]">
            We are onboarding a few teams at a time and shaping each workspace to the business behind it: your part numbers and BOMs, the stores and registers you sell through, the carriers you ship with, and the reports you actually read.
          </p>
          <ul className="mt-8 flex flex-col gap-3 text-[14px] leading-6 text-text-secondary">
            {WAITLIST_POINTS.map((p) => (
              <li key={p} className="flex gap-3">
                <Check className="mt-1 h-4 w-4 shrink-0 text-success" />
                {p}
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={100}>
          <div className="rounded-[var(--radius-lg)] bg-bg p-6 shadow-[var(--shadow-bevel),var(--shadow-card)] md:p-8">
            <h3 className="text-[20px] font-semibold tracking-[-0.01em] text-text">Join the waitlist</h3>
            <p className="mt-1.5 text-[14px] leading-6 text-text-secondary">A few lines about your business is plenty. We come back with questions, then build.</p>
            <div className="mt-6">
              <WaitlistForm />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
