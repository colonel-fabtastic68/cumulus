import Image from "next/image";
import { Download, Globe, Link2, Mail, Phone } from "lucide-react";
import { fullName, telUri, vcard, type ContactCard as Card } from "@/lib/cards";

/** The QR code as inline SVG, drawn on the server so the page needs no JavaScript to show it. */
async function qrSvg(text: string): Promise<string> {
  const bwip = await import("bwip-js/node");
  const svg = bwip.toSVG({ bcid: "qrcode", text, scale: 3, padding: 0 });
  return svg.replace(/^<svg([^>]*?)\swidth="[^"]*"/, "<svg$1").replace(/^<svg([^>]*?)\sheight="[^"]*"/, "<svg$1").replace(/^<svg/, '<svg role="img" aria-label="QR code with the contact card" style="width:100%;height:100%;display:block"');
}

/**
 * A digital business card for a phone screen: name, role, the ways to reach
 * them, a Save contact button, and a QR code that carries the vCard itself,
 * so a scan from another phone offers "Add contact" straight away.
 */
export async function ContactCard({ card }: { card: Card }) {
  const name = fullName(card);
  const svg = await qrSvg(vcard(card));
  const rows = [
    card.phone ? { icon: <Phone />, label: card.phone, href: `tel:${telUri(card.phone)}` } : null,
    card.email ? { icon: <Mail />, label: card.email, href: `mailto:${card.email}` } : null,
    card.website ? { icon: <Globe />, label: card.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""), href: card.website } : null,
    card.linkedin ? { icon: <Link2 />, label: "LinkedIn", href: card.linkedin } : null,
  ].filter((r): r is NonNullable<typeof r> => !!r);

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col px-5 pb-10 pt-8">
      <section className="rounded-[20px] border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-3">
          <Image src="/icons/icon-192.png" alt="" width={44} height={44} className="rounded-[22%]" priority />
          <div>
            <div className="text-[13px] font-semibold text-text">{card.org}</div>
            {card.blurb && <div className="text-[12px] text-text-secondary">{card.blurb}</div>}
          </div>
        </div>
        <h1 className="mt-6 text-[30px] font-semibold leading-9 tracking-[-0.02em] text-text">{name}</h1>
        <p className="mt-1 text-[15px] text-text-secondary">
          {card.title} · {card.org}
        </p>

        <a href={`/${card.slug}/contact.vcf`} download className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-primary text-[15px] font-semibold text-text-inverse transition-colors hover:bg-primary-hover">
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

      <section className="mt-4 rounded-[20px] border border-border bg-surface p-6 text-center shadow-[var(--shadow-card)]">
        <div className="mx-auto aspect-square w-full max-w-[260px] rounded-[12px] bg-white p-3" dangerouslySetInnerHTML={{ __html: svg }} />
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
