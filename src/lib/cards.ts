/**
 * Digital business cards at /<slug>: unlisted pages with a vCard QR code so a
 * phone scan offers "Add contact". Fill in the details here; nothing else
 * needs to change to add a person.
 */
export interface ContactCard {
  slug: string;
  first: string;
  last: string;
  title: string;
  org: string;
  email?: string;
  phone?: string;
  website?: string;
  linkedin?: string;
  /** One line under the name on the page. */
  blurb?: string;
  /** Other hats the same person wears: each becomes a tab with its own role, company, QR code and vCard. */
  personas?: Persona[];
}

/** A tab on a card. Fields left out fall back to the person's main card. */
export interface Persona extends Partial<Omit<ContactCard, "slug" | "first" | "last" | "personas">> {
  id: string;
  /** Tab label. */
  label: string;
}

export const CARDS: Record<string, ContactCard> = {
  baker: {
    slug: "baker",
    first: "Baker",
    last: "Cobb",
    title: "Founder",
    org: "cumulusOS",
    email: "bakerjcobb@gmail.com",
    phone: "(704) 441-4765",
    website: "https://www.cumulusos.com",
    linkedin: "https://www.linkedin.com/in/bakercobb/",
    blurb: "Inventory that keeps up with your team.",
    personas: [
      {
        id: "orion",
        label: "Orion",
        org: "Orion",
        title: "Marketing",
        blurb: "Marketing and brand work.",
        website: "",
      },
    ],
  },
  mitch: {
    slug: "mitch",
    first: "Mitch",
    last: "Gruchalla",
    title: "Co-founder",
    org: "cumulusOS",
    email: "mitchgruchalla@gmail.com",
    phone: "(509) 237-1478",
    website: "https://www.cumulusos.com",
    linkedin: "https://www.linkedin.com/in/mitchell-gruchalla-b7244a1ba/",
    blurb: "Inventory that keeps up with your team.",
  },
};

export function cardBySlug(slug: string | undefined): ContactCard | null {
  return slug ? (CARDS[slug.toLowerCase()] ?? null) : null;
}

export function fullName(c: Pick<ContactCard, "first" | "last">): string {
  return [c.first, c.last].filter(Boolean).join(" ");
}

/** Every tab of a card, the main one first, each a complete card. */
export function personasOf(card: ContactCard): Array<{ id: string; label: string; card: ContactCard }> {
  const { personas, ...base } = card;
  return [{ id: "main", label: card.org, card: base }, ...(personas ?? []).map((p) => ({ id: p.id, label: p.label, card: { ...base, ...Object.fromEntries(Object.entries(p).filter(([k, v]) => k !== "id" && k !== "label" && v !== undefined)) } as ContactCard }))];
}

export function personaCard(card: ContactCard, id: string | null | undefined): ContactCard {
  return (personasOf(card).find((p) => p.id === id) ?? personasOf(card)[0]!).card;
}

/** A North-American number as +1XXXXXXXXXX; anything else keeps its digits and leading +. */
export function telUri(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  return digits;
}

/** vCard 3.0 text: what the QR code carries and what the .vcf download serves. */
export function vcard(c: ContactCard): string {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${esc(c.last)};${esc(c.first)};;;`, `FN:${esc(fullName(c))}`, `ORG:${esc(c.org)}`, `TITLE:${esc(c.title)}`];
  if (c.phone) lines.push(`TEL;TYPE=CELL,VOICE:${telUri(c.phone)}`);
  if (c.email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${c.email}`);
  if (c.website) lines.push(`URL:${c.website}`);
  if (c.linkedin) lines.push(`X-SOCIALPROFILE;TYPE=linkedin:${c.linkedin}`);
  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

/** The .vcf file as a download; `tab` picks a persona. */
export function vcardResponse(slug: string, tab?: string | null): Response {
  const base = cardBySlug(slug);
  if (!base) return new Response("Not found", { status: 404 });
  const c = personaCard(base, tab);
  const file = `${[fullName(c), c.org].join(" ").replace(/[^\w-]+/g, "-") || c.slug}.vcf`;
  return new Response(vcard(c), {
    headers: {
      "content-type": "text/vcard; charset=utf-8",
      "content-disposition": `attachment; filename="${file}"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
