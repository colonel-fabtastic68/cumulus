import Link from "next/link";
import { Mail } from "lucide-react";
import { AppIcon } from "@/components/ui";
import { CONTACT_EMAIL } from "@/lib/contact";
import type { RuntimeConfig } from "@/lib/firebase-config";
import { MobileMenu } from "./MobileMenu";
import { NavLinks } from "./NavLinks";
import { SessionCta } from "./SessionCta";

/** The pages of the site. Absolute paths, so they work from the legal pages too. */
export const SITE_LINKS = [
  { href: "/product", label: "Product" },
  { href: "/motorsport", label: "Motorsport" },
  { href: "/automotive", label: "Automotive" },
  { href: "/connect", label: "Integrations" },
];

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-2.5 text-[15px] font-semibold text-text ${className ?? ""}`}>
      <AppIcon size={28} />
      cumulusOS
    </Link>
  );
}

export function MarketingNav({ runtimeConfig }: { runtimeConfig: RuntimeConfig }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/85 backdrop-blur">
      <div className="relative mx-auto flex h-16 max-w-[1120px] items-center gap-6 px-6">
        <Wordmark />
        <NavLinks links={SITE_LINKS} />
        <div className="ml-auto flex items-center gap-2">
          <SessionCta runtimeConfig={runtimeConfig} placement="nav" />
          <MobileMenu links={SITE_LINKS} accounts={runtimeConfig.firebase !== null} />
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto grid max-w-[1120px] gap-10 px-6 py-12 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <Wordmark />
          <p className="mt-3 max-w-[360px] text-[13.5px] leading-6 text-text-secondary">Inventory, builds and orders for motorsport and aftermarket automotive manufacturers, with Strato doing the bulk work you approve.</p>
          <a href={`mailto:${CONTACT_EMAIL}`} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-text hover:text-accent">
            <Mail className="h-3.5 w-3.5 text-text-secondary" />
            {CONTACT_EMAIL}
          </a>
          <p className="mt-1 text-[13px] text-text-secondary">Proudly North Carolinian.</p>
        </div>
        <div className="grid gap-8 sm:grid-cols-3">
          <FooterColumn title="Product" links={[...SITE_LINKS, { href: "/#demo", label: "Book a demo" }]} />
          <FooterColumn
            title="Company"
            links={[
              { href: `mailto:${CONTACT_EMAIL}`, label: "Contact" },
              { href: "/#contact", label: "Not in vehicles?" },
              { href: "/sign-in", label: "Sign in" },
            ]}
          />
          <FooterColumn
            title="Legal"
            links={[
              { href: "/privacy", label: "Privacy policy" },
              { href: "/terms", label: "Terms of service" },
              { href: "/dpa", label: "Data processing" },
              { href: "/eula", label: "License agreement" },
            ]}
          />
        </div>
      </div>
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-2 px-6 pb-8 text-[12px] text-text-tertiary">
        <span>© {new Date().getFullYear()} cumulusOS. cumulusOS and Strato are trademarks of cumulusOS.</span>
        <span>Other names and marks belong to their owners.</span>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: Array<{ href: string; label: string }> }) {
  return (
    <nav aria-label={title}>
      <div className="text-[13px] font-semibold text-text">{title}</div>
      <ul className="mt-3 flex flex-col gap-2 text-[13.5px] text-text-secondary">
        {links.map((l) => (
          <li key={l.href + l.label}>
            {l.href.startsWith("/") && !l.href.includes("#") ? (
              <Link href={l.href} className="hover:text-text">
                {l.label}
              </Link>
            ) : (
              <a href={l.href} className="hover:text-text">
                {l.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}
