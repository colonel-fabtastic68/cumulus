import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContactCard } from "@/components/marketing/ContactCard";
import { cardBySlug, fullName } from "@/lib/cards";

const card = cardBySlug("baker");

export const metadata: Metadata = { title: card ? `${fullName(card)} · ${card.org}` : "cumulusOS", robots: { index: false, follow: false } };

export default function Page() {
  if (!card) notFound();
  return <ContactCard card={card} />;
}
