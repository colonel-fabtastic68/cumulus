import { fullName, personasOf, telUri, vcard, type ContactCard as Card } from "@/lib/cards";
import { CardView, type CardPanel } from "./CardView";

/** The QR code as inline SVG, drawn on the server so the page needs no JavaScript to show it. */
async function qrSvg(text: string): Promise<string> {
  const bwip = await import("bwip-js/node");
  const svg = bwip.toSVG({ bcid: "qrcode", text, scale: 3, padding: 0 });
  return svg.replace(/^<svg([^>]*?)\swidth="[^"]*"/, "<svg$1").replace(/^<svg([^>]*?)\sheight="[^"]*"/, "<svg$1").replace(/^<svg/, '<svg role="img" aria-label="QR code with the contact card" style="width:100%;height:100%;display:block"');
}

/**
 * A digital business card for a phone screen: name, role, the ways to reach
 * them, a Save contact button, and a QR code that carries the vCard itself,
 * so a scan from another phone offers "Add contact" straight away. A person
 * with more than one hat gets a tab per card.
 */
export async function ContactCard({ card }: { card: Card }) {
  const panels: CardPanel[] = await Promise.all(
    personasOf(card).map(async ({ id, label, card: c }) => ({
      id,
      label,
      slug: c.slug,
      name: fullName(c),
      first: c.first,
      org: c.org,
      title: c.title,
      blurb: c.blurb,
      email: c.email,
      phone: c.phone,
      tel: c.phone ? telUri(c.phone) : undefined,
      website: c.website,
      linkedin: c.linkedin,
      svg: await qrSvg(vcard(c)),
    })),
  );
  return <CardView panels={panels} />;
}
