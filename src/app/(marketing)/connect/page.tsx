import type { Metadata } from "next";
import { ArrowDownToLine, ArrowUpFromLine, FileSpreadsheet, KeyRound, Plug, RefreshCw, Webhook } from "lucide-react";
import { BrandMark, type BrandId } from "@/components/marketing/IntegrationLogos";
import { Reveal } from "@/components/marketing/Reveal";
import { SavingsCalculator } from "@/components/marketing/SavingsCalculator";
import { CheckList, CtaBand, FeatureGrid, PageHero, SectionTitle, container } from "@/components/marketing/shared";

export const metadata: Metadata = {
  title: "Integrations · cumulusOS",
  description: "How cumulusOS connects to Shopify, WooCommerce, Square, Clover, QuickBooks, Shippo and EasyPost in a few clicks, keeps stock in sync with webhooks, and what the re-keying it replaces costs a shop every week.",
};

const CONNECTIONS: Array<{ id: BrandId; name: string; direction: string; body: string }> = [
  { id: "shopify", name: "Shopify", direction: "Two-way", body: "Products and orders come in, stock levels and edits go out, and webhooks keep both sides live within seconds of a sale." },
  { id: "woocommerce", name: "WooCommerce", direction: "Two-way", body: "The same two-way sync for WordPress stores: categories, prices and status pushed, orders pulled, stock levels corrected after every sale." },
  { id: "square", name: "Square", direction: "Register in", body: "The item library comes in by SKU, in-store counts become opening quantities, and counter sales relieve the same stock the web store sells." },
  { id: "clover", name: "Clover", direction: "Register in", body: "Inventory, prices and product codes from the register, matched by SKU and synced nightly." },
  { id: "quickbooks", name: "QuickBooks Online", direction: "Books in", body: "Products and services in by SKU with sales price, purchase cost and reorder point, so the books and the shelf agree." },
  { id: "shippo", name: "Shippo", direction: "Shipping out", body: "Rates, labels and tracking for every carrier on your Shippo account when you ship an order from cumulusOS." },
  { id: "easypost", name: "EasyPost", direction: "Shipping out", body: "Rate-shop the carriers on your account, buy the label and follow the parcel to the door." },
];

const HOW = [
  { icon: KeyRound, title: "Connect in a few clicks", body: "Sign in to the platform from Integrations. Credentials are checked with the platform and kept on the server, never in the browser." },
  { icon: ArrowDownToLine, title: "Import what is there", body: "Products, variants, prices and open orders come in by SKU. Matches are shown before anything is written; duplicates are merged, not doubled." },
  { icon: Webhook, title: "Stay live with webhooks", body: "A sale, a refund or a new product on the platform updates cumulusOS within seconds. A nightly pass catches anything a webhook missed." },
  { icon: ArrowUpFromLine, title: "Push the truth back out", body: "Stock levels, prices and status flow from the ledger to every connected store and register, so no channel oversells another." },
  { icon: RefreshCw, title: "Reconcile without a spreadsheet", body: "The sync log shows every change with its source. Mismatches are listed, not hidden, and fixed from the same screen." },
  { icon: Plug, title: "Beyond the built-ins", body: "Other agents reach every Strato tool over MCP, behind a token you set, and any spreadsheet still imports with columns that map themselves." },
];

export default function ConnectPage() {
  return (
    <>
      <PageHero title="Connects to what you already run." body="Stores, registers, accounting and carriers plug in under Integrations. Stock levels push out, orders come in, and the hours spent re-keying between systems go back to the shop." secondary={{ href: "/product", label: "See the product" }}>
        <Reveal className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-4 md:mt-14">
          {CONNECTIONS.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-2.5 text-[14px] font-medium text-text">
              <BrandMark id={c.id} size={26} />
              {c.name}
            </span>
          ))}
        </Reveal>
      </PageHero>

      <section>
        <div className={`${container} py-20 md:py-28`}>
          <SectionTitle title="Each one does a specific job." body="No connector pretends to do everything. Each card below says what comes in, what goes out, and how often." />
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CONNECTIONS.map((c, i) => (
              <Reveal key={c.id} delay={(i % 3) * 50}>
                <div className="flex h-full flex-col rounded-[var(--radius)] bg-surface p-5 shadow-[var(--shadow-bevel)]">
                  <div className="flex items-center gap-3">
                    <BrandMark id={c.id} size={28} />
                    <h3 className="text-[15px] font-semibold text-text">{c.name}</h3>
                    <span className="ml-auto rounded-full bg-accent-soft px-2 py-0.5 text-[11.5px] font-medium text-brand-red-deep">{c.direction}</span>
                  </div>
                  <p className="mt-3 text-[13.5px] leading-6 text-text-secondary">{c.body}</p>
                </div>
              </Reveal>
            ))}
            <Reveal delay={100}>
              <div className="flex h-full flex-col justify-center gap-3 rounded-[var(--radius)] border border-dashed border-border-strong p-5">
                <p className="flex items-start gap-3 text-[13.5px] leading-6 text-text-secondary">
                  <FileSpreadsheet className="mt-1 h-4 w-4 shrink-0 text-accent" />
                  Any spreadsheet, PDF or photographed count sheet imports: columns map themselves and unknown ones become custom fields.
                </p>
                <p className="flex items-start gap-3 text-[13.5px] leading-6 text-text-secondary">
                  <Plug className="mt-1 h-4 w-4 shrink-0 text-accent" />
                  Need another platform? Tell us on the demo. Connections are built with the first team that needs them.
                </p>
              </div>
            </Reveal>
          </div>
          <p className="mt-6 text-[12.5px] text-text-tertiary">Brand names and marks belong to their owners and appear only to show that the connection exists.</p>
        </div>
      </section>

      <section className="border-t border-border bg-surface">
        <div className={`${container} py-20 md:py-28`}>
          <SectionTitle title="Connect, import, stay live, push back." body="The same six steps for every platform, so the second connection takes less time than the first." />
          <FeatureGrid items={HOW} columns={3} className="mt-14" />
        </div>
      </section>

      <section className="border-t border-border">
        <div className={`${container} grid gap-12 py-20 md:py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16`}>
          <Reveal>
            <h2 className="display">The re-keying is the expensive part.</h2>
            <p className="lede mt-4">Shops we work with spent six to ten hours a week per person typing orders from the store into the sheet, counts from the sheet into accounting, and corrections everywhere after every sale. Connecting the systems gives that time back on the first day, and the oversold orders stop with it.</p>
            <CheckList className="mt-8" items={["Orders arrive already matched to SKUs; nothing is typed twice.", "Stock levels correct themselves after every sale, on every channel.", "Month-end reconciliation becomes reading a log instead of rebuilding a sheet.", "Labels buy in one click from the order, at the rates your account already has."]} />
          </Reveal>
          <Reveal delay={100}>
            <SavingsCalculator />
          </Reveal>
        </div>
      </section>

      <CtaBand title="Connect your store on the demo call." body="Bring a Shopify, WooCommerce or Square login and we will import your catalog live, in thirty minutes." />
    </>
  );
}
