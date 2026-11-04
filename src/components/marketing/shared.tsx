import type { ComponentType, ReactNode } from "react";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { Reveal } from "./Reveal";

/** Shared width for every marketing section. */
export const container = "mx-auto w-full max-w-[1120px] px-6";

export function SectionTitle({ title, body, className, align = "left" }: { title: ReactNode; body?: ReactNode; className?: string; align?: "left" | "center" }) {
  return (
    <Reveal className={cn("max-w-[720px]", align === "center" && "mx-auto flex flex-col items-center text-center", className)}>
      <h2 className={cn("display", align === "center" && "mx-auto")}>{title}</h2>
      {body && <p className={cn("lede mt-4", align === "center" && "mx-auto")}>{body}</p>}
    </Reveal>
  );
}

/** The opening block of every page other than home: rule, headline, lede and the two calls to action. */
export function PageHero({ title, body, primary = { href: "/#demo", label: "Book a demo" }, secondary, children }: { title: ReactNode; body: ReactNode; primary?: { href: string; label: string }; secondary?: { href: string; label: string }; children?: ReactNode }) {
  return (
    <section className="landing-wash border-b border-border">
      <div className={`${container} pt-14 pb-12 md:pt-20 md:pb-16`}>
        <div className="max-w-[800px]">
          <h1 className="hero hero-in" style={{ animationDelay: "60ms" }}>
            {title}
          </h1>
          <p className="lede hero-in mt-5" style={{ animationDelay: "120ms" }}>
            {body}
          </p>
          <div className="hero-in mt-7 flex flex-wrap items-center gap-2" style={{ animationDelay: "180ms" }}>
            <Button variant="primary" size="lg" href={primary.href} iconRight={<ArrowRight />}>
              {primary.label}
            </Button>
            {secondary && (
              <Button size="lg" href={secondary.href}>
                {secondary.label}
              </Button>
            )}
          </div>
        </div>
        {children}
      </div>
    </section>
  );
}

/** A list of short wins with red checks. */
export function CheckList({ items, className, size = "md" }: { items: ReactNode[]; className?: string; size?: "md" | "lg" }) {
  return (
    <ul className={cn("flex flex-col gap-3", size === "lg" ? "text-[15.5px] leading-6" : "text-[14px] leading-6", "text-text-secondary", className)}>
      {items.map((item, i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-1 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-brand-red">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export interface FeatureItem {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
}

/** Icon, title and a sentence or two, in two or three columns. */
export function FeatureGrid({ items, columns = 2, className }: { items: FeatureItem[]; columns?: 2 | 3; className?: string }) {
  return (
    <ul className={cn("grid gap-x-10 gap-y-9", columns === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "md:grid-cols-2", className)}>
      {items.map(({ icon: Icon, title, body }, i) => (
        <Reveal key={title} delay={(i % columns) * 60}>
          <li className="flex gap-4">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-surface text-brand-red shadow-[var(--shadow-bevel)]">
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
  );
}

/** Problem on the left, what cumulusOS does about it on the right. */
export function PainPoints({ items }: { items: Array<{ pain: string; fix: string; detail: string }> }) {
  return (
    <ol className="flex flex-col">
      {items.map((it, i) => (
        <Reveal key={it.pain} delay={i * 60}>
          <li className="grid gap-3 border-t border-border py-7 first:border-t-0 first:pt-0 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-10">
            <div>
              <div className="text-[12.5px] font-[550] text-text-tertiary">The problem</div>
              <h3 className="mt-1.5 text-[18px] font-semibold leading-6 tracking-[-0.01em] text-text">{it.pain}</h3>
            </div>
            <div>
              <div className="text-[12.5px] font-[550] text-brand-red">In cumulusOS</div>
              <p className="mt-1.5 text-[15.5px] font-medium leading-6 text-text">{it.fix}</p>
              <p className="mt-1.5 text-[14px] leading-6 text-text-secondary">{it.detail}</p>
            </div>
          </li>
        </Reveal>
      ))}
    </ol>
  );
}

/** Closing band: brand black with a red edge, one line and one button. */
export function CtaBand({ title, body, label = "Book a demo", href = "/#demo", secondary }: { title: ReactNode; body?: ReactNode; label?: string; href?: string; secondary?: { href: string; label: string } }) {
  return (
    <section className="border-t border-border">
      <div className={`${container} py-16 md:py-20`}>
        <Reveal>
          <div className="relative overflow-hidden rounded-[var(--radius-lg)] bg-brand-black px-6 py-10 text-band-text md:px-12 md:py-14">
            <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-brand-red" />
            <span aria-hidden className="pat-chevrons absolute -right-6 -bottom-4 h-40 w-40 opacity-90" />
            <div className="relative grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <h2 className="display-sm text-band-text">{title}</h2>
                {body && <p className="mt-3 max-w-[34em] text-[15px] leading-6 text-band-text-secondary">{body}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="lg" href={href} iconRight={<ArrowRight />} className="bg-white text-text hover:bg-white/90">
                  {label}
                </Button>
                {secondary && (
                  <Button size="lg" variant="tertiary" href={secondary.href} className="text-band-text hover:bg-white/10">
                    {secondary.label}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
