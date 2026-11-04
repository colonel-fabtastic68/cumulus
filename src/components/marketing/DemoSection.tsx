import { Clock, Mail, Users } from "lucide-react";
import { CONTACT_EMAIL } from "@/lib/contact";
import { InquiryForm } from "./InquiryForm";
import { LazyCalendly } from "./LazyCalendly";
import { Reveal } from "./Reveal";
import { CheckList, Eyebrow, container } from "./shared";

/** The booking section: Calendly inline when a link is set, the request form when it is not. */
export function DemoSection({ calendlyUrl }: { calendlyUrl?: string }) {
  return (
    <section id="demo" className="scroll-mt-16 border-t border-border bg-surface">
      <div className={`${container} grid gap-12 py-20 md:py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16`}>
        <Reveal>
          <Eyebrow>Book a demo</Eyebrow>
          <h2 className="mt-3 text-[30px] font-semibold leading-[1.1] tracking-[-0.02em] text-text md:text-[40px]">Thirty minutes on your own parts.</h2>
          <p className="mt-4 text-[16px] leading-7 text-text-secondary md:text-[17px]">Bring a spreadsheet or a few part numbers. We walk through receiving, builds, orders and Strato on your data, with the people who build cumulusOS.</p>
          <CheckList className="mt-8" items={["No slides. The demo runs in a real workspace with your numbers.", "Leave with a plan for what to import first and what to connect.", "If it is not a fit, we will say so and point you somewhere better."]} />
          <dl className="mt-8 grid gap-4 text-[13.5px] text-text-secondary sm:grid-cols-3">
            <div className="flex items-start gap-2.5">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <div>
                <dt className="font-medium text-text">30 minutes</dt>
                <dd>Video call, your screen or ours.</dd>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <div>
                <dt className="font-medium text-text">The founders</dt>
                <dd>Baker and Mitch, not a sales team.</dd>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Mail className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <div>
                <dt className="font-medium text-text">Prefer email?</dt>
                <dd>
                  <a href={`mailto:${CONTACT_EMAIL}`} className="text-text hover:text-accent">
                    {CONTACT_EMAIL}
                  </a>
                </dd>
              </div>
            </div>
          </dl>
        </Reveal>
        <Reveal delay={100}>
          {calendlyUrl ? (
            <div className="overflow-hidden rounded-[var(--radius-lg)] bg-bg shadow-[var(--shadow-bevel),var(--shadow-card)]">
              <LazyCalendly url={calendlyUrl} />
            </div>
          ) : (
            <div className="rounded-[var(--radius-lg)] bg-bg p-6 shadow-[var(--shadow-bevel),var(--shadow-card)] md:p-8">
              <h3 className="text-[20px] font-semibold tracking-[-0.01em] text-text">Request a demo</h3>
              <p className="mt-1.5 text-[14px] leading-6 text-text-secondary">A few lines about your shop is plenty. We reply with a few times that work.</p>
              <div className="mt-6">
                <InquiryForm kind="demo" submitLabel="Request a demo" stockLabel="What do you make or sell?" />
              </div>
            </div>
          )}
        </Reveal>
      </div>
    </section>
  );
}
