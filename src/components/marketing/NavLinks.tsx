"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Desktop page links, from the lg breakpoint (below it the links live in MobileMenu); the current page is underlined in red. */
export function NavLinks({ links }: { links: Array<{ href: string; label: string }> }) {
  const pathname = usePathname();
  return (
    <nav className="hidden items-center gap-1 lg:flex" aria-label="Pages">
      {links.map((l) => {
        const active = pathname === l.href;
        return (
          <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined} className={`relative rounded-[var(--radius-sm)] px-3 py-1.5 text-[13px] font-medium hover:bg-[rgba(0,0,0,0.05)] hover:text-text ${active ? "text-text after:absolute after:inset-x-3 after:-bottom-[13px] after:h-[2px] after:rounded-full after:bg-accent" : "text-text-secondary"}`}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
