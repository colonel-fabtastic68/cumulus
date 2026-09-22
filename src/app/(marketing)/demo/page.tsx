import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui";
import { StartDemoButton } from "@/components/marketing/StartDemoButton";
import { buildSeed } from "@/lib/seed";

export const metadata: Metadata = {
  title: "Try the demo · cumulusOS",
  description: "Open a sample workspace in your browser: parts, BOMs, receiving, orders, returns and Strato, with nothing to install and no account.",
};

const TOUR: Array<{ title: string; body: string; href: string }> = [
  { title: "Open a part and read its ledger", body: "Inventory lists every part with on-hand, reserved and days of cover. Open one to see each movement and the balance after it.", href: "/inventory" },
  { title: "Complete a build", body: "Builds consume the BOM, sub-assemblies included, and put the finished pedals on the shelf. Expected waste is already in the requirement.", href: "/builds" },
  { title: "Receive a delivery", body: "Book a supplier delivery with the date it really arrived. Lots keep their cost, so valuation stays honest.", href: "/receiving" },
  { title: "Ask Strato for a change", body: "Try \"which parts are below their minimum?\" or \"raise the min on every enclosure by 20%\". Strato drafts the change and waits for your approval.", href: "/strato" },
  { title: "Ship an order", body: "Open orders reserve stock; partial shipments and backorders are tracked per line.", href: "/orders" },
  { title: "See where your store connects", body: "Integrations shows how Shopify, WooCommerce, QuickBooks and Square plug in: products and orders sync in, stock levels push out.", href: "/integrations" },
];

export default function DemoPage() {
  const seed = buildSeed();
  const counts = { items: seed.items.length, orders: seed.orders.length, suppliers: seed.suppliers.length, members: seed.members.length };
  return (
    <section className="mx-auto w-full max-w-[1120px] px-6 py-14 md:py-20">
      <div className="max-w-[640px]">
        <h1 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.025em] text-text md:text-[44px]">Try cumulusOS in your browser</h1>
        <p className="mt-4 text-[16px] leading-7 text-text-secondary md:text-[17px]">
          The demo opens Halcyon Audio, a sample guitar-pedal maker: {counts.items} parts and assemblies, {counts.suppliers} suppliers, {counts.orders} orders, receiving, returns and a team of {counts.members}. Everything runs on this device, nothing is sent anywhere, and you can start over any time.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <StartDemoButton>Open the demo</StartDemoButton>
          <StartDemoButton variant="secondary" fresh>
            Start fresh
          </StartDemoButton>
        </div>
        <p className="mt-3 text-[13px] text-text-tertiary">No account, no install. Strato answers with the sample data.</p>
      </div>

      <div className="mt-14 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {TOUR.map((t, i) => (
          <div key={t.title} className="rounded-[var(--radius-lg)] bg-surface p-5 shadow-[var(--shadow-card)]">
            <div className="text-[12px] font-medium text-text-tertiary">{i + 1}</div>
            <h2 className="mt-1 text-[15px] font-semibold text-text">{t.title}</h2>
            <p className="mt-2 text-[13.5px] leading-6 text-text-secondary">{t.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-14 grid gap-6 rounded-[var(--radius-lg)] border border-border p-6 md:grid-cols-2 md:p-8">
        <div>
          <h2 className="text-[18px] font-semibold text-text">Coming from Shopify?</h2>
          <p className="mt-2 text-[14px] leading-6 text-text-secondary">
            The demo is the same workspace that connects to a store. With an account, cumulusOS pulls your products and orders in, keeps counts in step as you receive, build and ship, and pushes stock levels back to Shopify. Connecting a store needs an account so the credentials live on the server, not in a browser.
          </p>
        </div>
        <div>
          <h2 className="text-[18px] font-semibold text-text">Prefer a walkthrough?</h2>
          <p className="mt-2 text-[14px] leading-6 text-text-secondary">Half an hour with the people who build cumulusOS, on your own part numbers and BOMs.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button size="lg" href="/book">
              Book a demo
            </Button>
            <Link href="/sign-up" className="inline-flex items-center text-[13px] font-medium text-text hover:underline">
              Create an account
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
