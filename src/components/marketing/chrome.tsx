import Link from "next/link";
import { CloudMark } from "@/components/ui";
import type { RuntimeConfig } from "@/lib/firebase-config";
import { SessionCta } from "./SessionCta";

const LINKS = [
  { href: "#product", label: "Product" },
  { href: "#nimbus", label: "Nimbus" },
  { href: "#pilot", label: "Pilot" },
];

export function Wordmark({ className }: { className?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-2.5 text-[15px] font-semibold text-text ${className ?? ""}`}>
      <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-primary text-text-inverse">
        <CloudMark />
      </span>
      Cumulus
    </Link>
  );
}

export function MarketingNav({ runtimeConfig }: { runtimeConfig: RuntimeConfig }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-6 px-6">
        <Wordmark />
        <nav className="hidden items-center gap-1 md:flex" aria-label="Sections">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="rounded-[var(--radius-sm)] px-3 py-1.5 text-[13px] font-medium text-text-secondary hover:bg-[rgba(0,0,0,0.05)] hover:text-text">
              {l.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto">
          <SessionCta runtimeConfig={runtimeConfig} placement="nav" />
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-6 px-6 py-10 md:flex-row md:items-center md:justify-between">
        <div>
          <Wordmark />
          <p className="mt-2 text-[13px] text-text-secondary">Agentic inventory for small product teams.</p>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-text-secondary" aria-label="Footer">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="hover:text-text">
              {l.label}
            </a>
          ))}
          <Link href="/sign-in" className="hover:text-text">
            Sign in
          </Link>
          <a href="https://github.com/colonel-fabtastic68/cumulus" className="hover:text-text" rel="noreferrer">
            GitHub
          </a>
        </nav>
      </div>
      <div className="mx-auto max-w-[1120px] px-6 pb-8 text-[12px] text-text-tertiary">© {new Date().getFullYear()} Cumulus</div>
    </footer>
  );
}
