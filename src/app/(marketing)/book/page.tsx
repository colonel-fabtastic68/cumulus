import type { Metadata } from "next";
import { Button } from "@/components/ui";
import { CalendlyEmbed } from "@/components/marketing/CalendlyEmbed";
import { runtimeConfigFromEnv } from "@/lib/firebase-config";

export const metadata: Metadata = {
  title: "Book a demo · cumulusOS",
  description: "See cumulusOS on your own parts and BOMs: a walk through inventory, receiving, builds and Strato with the people who build it.",
};

export default function DemoPage() {
  const { calendlyUrl } = runtimeConfigFromEnv();
  return (
    <section className="mx-auto w-full max-w-[1120px] px-6 py-14 md:py-20">
      <div className="max-w-[640px]">
        <h1 className="text-[34px] font-semibold leading-[1.08] tracking-[-0.025em] text-text md:text-[44px]">Book a demo</h1>
        <p className="mt-4 text-[16px] leading-7 text-text-secondary md:text-[17px]">
          Half an hour with the people who build cumulusOS. Bring a spreadsheet or a few part numbers and we will walk through receiving, BOMs, orders and Strato on your own data.
        </p>
      </div>
      {calendlyUrl ? (
        <CalendlyEmbed url={calendlyUrl} className="mt-8" />
      ) : (
        <div className="mt-8 max-w-[640px] rounded-[var(--radius-lg)] bg-surface p-6 shadow-[var(--shadow-card)]">
          <h2 className="text-[16px] font-semibold text-text">Booking is being set up</h2>
          <p className="mt-2 text-[14px] leading-6 text-text-secondary">The calendar is not connected yet. You can start on your own in the meantime: create an account, import a spreadsheet, and ask Strato for the first change.</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button variant="primary" size="lg" href="/sign-up">
              Create an account
            </Button>
            <Button size="lg" href="/sign-in">
              Sign in
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
