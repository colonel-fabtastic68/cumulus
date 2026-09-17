import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ExternalLink } from "lucide-react";
import { getFirestore } from "firebase-admin/firestore";
import type { CalendarEvent, WorkspaceSettings } from "@/lib/types";
import { eventIcs, formatEventWhen } from "@/lib/calendar";
import { adminApp, readServiceAccount } from "@/lib/mcp/adminStore";

export const dynamic = "force-dynamic";

async function loadShared(slug: string): Promise<{ event: CalendarEvent; company: string } | null> {
  if (!/^[a-z0-9]{6,32}$/.test(slug)) return null;
  const sa = readServiceAccount();
  if (!sa) return null;
  const db = getFirestore(adminApp(sa));
  const share = await db.doc(`eventShares/${slug}`).get();
  if (!share.exists) return null;
  const { workspaceId, eventId } = share.data() as { workspaceId: string; eventId: string };
  const [event, settings] = await Promise.all([db.doc(`workspaces/${workspaceId}/events/${eventId}`).get(), db.doc(`workspaces/${workspaceId}/settings/default`).get()]);
  if (!event.exists) return null;
  return { event: event.data() as CalendarEvent, company: (settings.data() as WorkspaceSettings | undefined)?.companyName?.trim() || "a cumulusOS workspace" };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const shared = await loadShared(slug);
  return { title: shared ? `${shared.event.title} · ${shared.company}` : "Event not found · cumulusOS", robots: { index: false } };
}

/** Public view of a shared team-calendar event. Nothing else from the workspace is reachable from here. */
export default async function SharedEventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shared = await loadShared(slug);
  if (!shared) {
    return (
      <main className="mx-auto w-full max-w-[560px] px-4 py-16">
        <h1 className="text-[22px] font-semibold text-text">This event link isn&apos;t live</h1>
        <p className="mt-2 text-[14px] text-text-secondary">It may have been deleted, or the link was copied incompletely. Ask whoever sent it for a fresh one.</p>
      </main>
    );
  }
  const { event, company } = shared;
  const ics = `data:text/calendar;charset=utf-8,${encodeURIComponent(eventIcs(event, { url: `https://cumulusos.com/e/${slug}` }))}`;
  return (
    <main className="mx-auto w-full max-w-[560px] px-4 py-12 sm:py-16">
      <p className="text-[12.5px] font-medium uppercase tracking-wide text-text-tertiary">{company} · team calendar</p>
      <h1 className="mt-2 text-[26px] font-semibold leading-8 text-text">{event.title}</h1>
      <p className="mt-2 flex items-center gap-2 text-[15px] text-text-secondary">
        <CalendarDays className="h-4 w-4" /> {formatEventWhen(event)}
      </p>
      {event.notes && <p className="mt-5 whitespace-pre-wrap text-[14.5px] leading-6 text-text">{event.notes}</p>}
      {event.links?.length ? (
        <ul className="mt-5 flex flex-col gap-2">
          {event.links.map((l) => (
            <li key={l.url}>
              <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[14px] text-accent hover:underline">
                {l.label || l.url} <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <a href={ics} download={`${event.title.replace(/[^\w.-]+/g, "-")}.ics`} className="inline-flex h-9 items-center rounded-[var(--radius-sm)] bg-primary px-3.5 text-[13.5px] font-medium text-text-inverse">
          Add to my calendar
        </a>
        <Link href="/" className="text-[13px] text-text-secondary hover:underline">
          What is cumulusOS?
        </Link>
      </div>
    </main>
  );
}
