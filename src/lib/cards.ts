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
}

export const CARDS: Record<string, ContactCard> = {
  baker: {
    slug: "baker",
    first: "Baker",
    last: "Cobb",
    title: "Founder",
    org: "cumulusOS",
    email: "baker@cumulusos.com",
    phone: "",
    website: "https://www.cumulusos.com",
    linkedin: "",
    blurb: "Inventory that keeps up with your team.",
  },
  mitch: {
    slug: "mitch",
    first: "Mitch",
    last: "",
    title: "Co-founder",
    org: "cumulusOS",
    email: "mitch@cumulusos.com",
    phone: "",
    website: "https://www.cumulusos.com",
    linkedin: "",
    blurb: "Inventory that keeps up with your team.",
  },
};

export function cardBySlug(slug: string | undefined): ContactCard | null {
  return slug ? (CARDS[slug.toLowerCase()] ?? null) : null;
}

export function fullName(c: ContactCard): string {
  return [c.first, c.last].filter(Boolean).join(" ");
}

/** vCard 3.0 text: what the QR code carries and what the .vcf download serves. */
export function vcard(c: ContactCard): string {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${esc(c.last)};${esc(c.first)};;;`, `FN:${esc(fullName(c))}`, `ORG:${esc(c.org)}`, `TITLE:${esc(c.title)}`];
  if (c.phone) lines.push(`TEL;TYPE=CELL,VOICE:${c.phone.replace(/[^\d+]/g, "")}`);
  if (c.email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${c.email}`);
  if (c.website) lines.push(`URL:${c.website}`);
  if (c.linkedin) lines.push(`X-SOCIALPROFILE;TYPE=linkedin:${c.linkedin}`);
  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

/** The .vcf file as a download. */
export function vcardResponse(slug: string): Response {
  const c = cardBySlug(slug);
  if (!c) return new Response("Not found", { status: 404 });
  const file = `${fullName(c).replace(/[^\w-]+/g, "-") || c.slug}.vcf`;
  return new Response(vcard(c), {
    headers: {
      "content-type": "text/vcard; charset=utf-8",
      "content-disposition": `attachment; filename="${file}"`,
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
