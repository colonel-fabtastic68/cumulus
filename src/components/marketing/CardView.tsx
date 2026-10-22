"use client";

import { useState } from "react";
import Image from "next/image";
import { Download, Globe, Link2, Mail, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CardPanel {
  id: string;
  label: string;
  slug: string;
  name: string;
  first: string;
  org: string;
  title: string;
  blurb?: string;
  email?: string;
  phone?: string;
  /** tel: target, already normalised. */
  tel?: string;
  website?: string;
  linkedin?: string;
  /** The QR code as inline SVG, drawn on the server. */
  svg: string;
}

/**
 * The card itself, with a tab per hat the person wears. Everything is
 * rendered on the server; this only switches which panel shows.
 */
export function CardView({ panels }: { panels: CardPanel[] }) {
  const [active, setActive] = useState(panels[0]!.id);
  const card = panels.find((p) => p.id === active) ?? panels[0]!;
  const vcf = `/${card.slug}/contact.vcf${card.id === "main" ? "" : `?tab=${encodeURIComponent(card.id)}`}`;
  const rows = [
    card.phone && card.tel ? { icon: <Phone />, label: card.phone, href: `tel:${card.tel}` } : null,
    card.email ? { icon: <Mail />, label: card.email, href: `mailto:${card.email}` } : null,
    card.website ? { icon: <Globe />, label: card.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), href: card.website } : null,
    card.linkedin ? { icon: <Link2 />, label: "LinkedIn", href: card.linkedin } : null,
  ].filter((r): r is NonNullable<typeof r> => !!r);

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col px-5 pb-10 pt-6">
      {panels.length > 1 && (
        <div role="tablist" aria-label="Cards" className="mb-4 flex gap-1 rounded-full border border-border bg-surface p-1 shadow-[var(--shadow-card)]">
          {panels.map((p) => (
            <button key={p.id} role="tab" type="button" aria-selected={p.id === active} onClick={() => setActive(p.id)} className={cn("h-9 flex-1 rounded-full text-[14px] font-medium transition-colors", p.id === active ? "bg-primary text-text-inverse" : "text-text-secondary hover:bg-surface-hover hover:text-text")}>
              {p.label}
            </button>
          ))}
        </div>
      )}

      <section key={card.id} className="animate-in rounded-[20px] border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-3">
          {card.id === "main" ? <Image src="/icons/icon-192.png" alt="" width={44} height={44} className="rounded-[22%]" priority /> : <span className="flex h-11 w-11 items-center justify-center rounded-[22%] bg-primary text-[18px] font-semibold text-text-inverse">{card.org.slice(0, 1)}</span>}
          <div>
            <div className="text-[13px] font-semibold text-text">{card.org}</div>
            {card.blurb && <div className="text-[12px] text-text-secondary">{card.blurb}</div>}
          </div>
        </div>
        <h1 className="mt-6 text-[30px] font-semibold leading-9 tracking-[-0.02em] text-text">{card.name}</h1>
        <p className="mt-1 text-[15px] text-text-secondary">
          {card.title} · {card.org}
        </p>

        <a href={vcf} download className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-primary text-[15px] font-semibold text-text-inverse transition-colors hover:bg-primary-hover">
          <Download className="h-4 w-4" />
          Save contact
        </a>

        {rows.length > 0 && (
          <ul className="mt-5 divide-y divide-border rounded-[12px] border border-border">
            {rows.map((r) => (
              <li key={r.label}>
                <a href={r.href} target={r.href.startsWith("http") ? "_blank" : undefined} rel={r.href.startsWith("http") ? "noreferrer" : undefined} className="flex items-center gap-3 px-4 py-3 text-[15px] text-text transition-colors hover:bg-surface-hover [&>svg]:h-4 [&>svg]:w-4 [&>svg]:shrink-0 [&>svg]:text-text-secondary">
                  {r.icon}
                  <span className="truncate">{r.label}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section key={`qr-${card.id}`} className="animate-in mt-4 rounded-[20px] border border-border bg-surface p-6 text-center shadow-[var(--shadow-card)]">
        <div className="mx-auto aspect-square w-full max-w-[260px] rounded-[12px] bg-white p-3" dangerouslySetInnerHTML={{ __html: card.svg }} />
        <p className="mt-4 text-[14px] font-medium text-text">Scan to add {card.first} to your contacts</p>
        <p className="mt-1 text-[12.5px] text-text-secondary">Point any phone camera at the code. The contact card is in the code itself, no app needed.</p>
      </section>

      <p className="mt-6 text-center text-[12px] text-text-tertiary">
        <a href="https://www.cumulusos.com" className="hover:text-text">
          cumulusos.com
        </a>
      </p>
    </main>
  );
}
