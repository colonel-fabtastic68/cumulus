import { ArrowRight, CalendarRange, Check, FileSpreadsheet, GitFork, Layers, Lock, PackageCheck, Plug, RotateCcw, Scale, ShoppingBag, Store, Timer, Users } from "lucide-react";
import type { RuntimeConfig } from "@/lib/firebase-config";
import { Badge, Button } from "@/components/ui";
import { FOUNDING_PLAN, planSavingsPct } from "@/lib/billing";
import { formatMoney } from "@/lib/format";
import { StratoPreview } from "./StratoPreview";
import { ProductPreview } from "./ProductPreview";
import { Reveal } from "./Reveal";
import { SessionCta } from "./SessionCta";

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

const INTEGRATIONS = [
  { icon: ShoppingBag, title: "Shopify exports", body: "Variant SKUs, quantities, prices, cost and images map on their own." },
  { icon: Store, title: "WooCommerce exports", body: "Stock, sale and regular price, brands, weight and dimensions, plus the product id." },
  { icon: FileSpreadsheet, title: "CSV and pasted sheets", body: "Any spreadsheet works. Unknown columns become custom fields with one click." },
  { icon: Plug, title: "MCP for other agents", body: "Every Strato tool is available to any MCP client, gated by a token you set." },
];

export function Integrations() {
  return (
    <section id="integrations" className="scroll-mt-16 border-t border-border bg-surface">
      <div className={`${container} py-20 md:py-24`}>
        <Reveal className="max-w-[640px]">
          <h2 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] text-text md:text-[40px]">Works with what you already run.</h2>
        </Reveal>
        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {INTEGRATIONS.map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={i * 50}>
              <div className="flex h-full flex-col rounded-[var(--radius)] bg-bg p-5 shadow-[var(--shadow-bevel)]">
                <Icon className="h-5 w-5 text-icon" />
                <h3 className="mt-4 text-[15px] font-semibold text-text">{title}</h3>
                <p className="mt-1 text-[13.5px] leading-6 text-text-secondary">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
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
          <p className="mt-4 text-[16px] leading-7 text-text-secondary md:text-[17px]">Pilots start with your own data, not a tutorial.</p>
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

export function Pricing({ runtimeConfig }: { runtimeConfig: RuntimeConfig }) {
  const plan = FOUNDING_PLAN;
  const price = (n: number) => formatMoney(n, plan.currency).replace(/\.00$/, "");
  return (
    <section id="pricing" className="scroll-mt-16 border-t border-border bg-surface">
      <div className={`${container} grid gap-12 py-20 md:py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16`}>
        <Reveal>
          <div className="text-[12px] font-[550] uppercase tracking-[0.08em] text-text-tertiary">Pricing</div>
          <h2 className="mt-3 text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] text-text md:text-[40px]">One plan. A founding price for early teams.</h2>
          <p className="mt-4 text-[16px] leading-7 text-text-secondary md:text-[17px]">
            cumulusOS is {price(plan.listMonthly)} a month for the whole company. Teams that join now pay {price(plan.monthly)}, keep that price for as long as they stay subscribed, and get every version we ship.
          </p>
          <ul className="mt-8 flex flex-col gap-3 text-[14px] text-text-secondary">
            <li className="flex gap-3">
              <Check className="mt-1 h-4 w-4 shrink-0 text-success" />
              No per-seat fees. Add the whole floor, the office and your accountant.
            </li>
            <li className="flex gap-3">
              <Check className="mt-1 h-4 w-4 shrink-0 text-success" />
              Billed monthly. Cancel any time from Settings.
            </li>
            <li className="flex gap-3">
              <Check className="mt-1 h-4 w-4 shrink-0 text-success" />
              Start free today and upgrade when you are ready.
            </li>
          </ul>
        </Reveal>
        <Reveal delay={100}>
          <div className="rounded-[var(--radius-lg)] bg-bg p-6 shadow-[var(--shadow-bevel),var(--shadow-card)] md:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge tone="accent" size="large">
                {plan.name}
              </Badge>
              <Badge tone="success" size="large">
                {planSavingsPct(plan)}% off
              </Badge>
            </div>
            <div className="mt-6 flex flex-wrap items-end gap-x-3 gap-y-1">
              <span className="text-[52px] font-semibold leading-none tracking-[-0.03em] text-text">{price(plan.monthly)}</span>
              <span className="pb-1.5 text-[15px] text-text-secondary">per month</span>
              <span className="pb-1.5 text-[19px] text-text-tertiary line-through decoration-[1.5px]">{price(plan.listMonthly)}</span>
            </div>
            <p className="mt-3 text-[15px] font-medium text-text">{plan.blurb}</p>
            <ul className="mt-6 flex flex-col gap-2.5">
              {plan.features.map((f) => (
                <li key={f} className="flex gap-3 text-[14px] leading-6 text-text-secondary">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-success" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button variant="primary" size="lg" href="/checkout" iconRight={<ArrowRight />}>
                Become a founding member
              </Button>
              <SessionCta runtimeConfig={runtimeConfig} placement="pricing" />
            </div>
            <p className="mt-4 flex items-center gap-1.5 text-[12.5px] text-text-tertiary">
              <Lock className="h-3.5 w-3.5" /> Billed monthly in {plan.currency}. Card details are handled by Stripe, never by cumulusOS.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function FinalCta({ runtimeConfig }: { runtimeConfig: RuntimeConfig }) {
  return (
    <section id="start" className="scroll-mt-16 border-t border-border bg-surface">
      <div className={`${container} py-20 md:py-24`}>
        <Reveal className="flex flex-col items-start gap-8 md:flex-row md:items-end md:justify-between">
          <div className="max-w-[560px]">
            <h2 className="text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] text-text md:text-[40px]">Start with your own data.</h2>
            <p className="mt-4 text-[16px] leading-7 text-text-secondary md:text-[17px]">Create a workspace, import a sheet, and see the first proposal from Strato in minutes.</p>
          </div>
          <SessionCta runtimeConfig={runtimeConfig} placement="band" />
        </Reveal>
      </div>
    </section>
  );
}

