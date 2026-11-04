"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui";

/** The page links and calls to action behind a hamburger on small screens. */
export function MobileMenu({ links, accounts }: { links: Array<{ href: string; label: string }>; accounts: boolean }) {
  const pathname = usePathname();
  // The sheet remembers the path it was opened on, so a navigation closes it without an effect.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;
  const setOpen = (next: boolean | ((o: boolean) => boolean)) => setOpenedOn((typeof next === "function" ? next(open) : next) ? pathname : null);
  return (
    <div className="md:hidden">
      <button type="button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen((o) => !o)} className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] text-text hover:bg-[rgba(0,0,0,0.05)]">
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>
      {open && (
        <div className="absolute inset-x-0 top-full border-b border-border bg-bg shadow-[var(--shadow-400)]">
          <nav className="flex flex-col px-4 py-3" aria-label="Pages">
            {links.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className={`rounded-[var(--radius-sm)] px-3 py-2.5 text-[15px] font-medium ${pathname === l.href ? "bg-accent-soft text-accent" : "text-text hover:bg-[rgba(0,0,0,0.05)]"}`}>
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2 border-t border-border px-4 py-3">
            {accounts && (
              <Button size="lg" href="/sign-in" className="flex-1">
                Sign in
              </Button>
            )}
            <Button size="lg" variant="primary" href="/#demo" className="flex-1" onClick={() => setOpen(false)}>
              Book a demo
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
