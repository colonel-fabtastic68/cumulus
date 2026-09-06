"use client";

import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import type { ActivityEvent, Item, Member } from "@/lib/types";
import { Avatar } from "@/components/ui";
import { formatDateTime, formatRelative } from "@/lib/format";
import { activityLink, typeLabel, type ActivityDayGroup } from "./activityUtils";

const FALLBACK_COLOR = "#8a8a8a";

function ActorAvatar({ event, membersById }: { event: ActivityEvent; membersById: Map<string, Member> }) {
  if (event.type.startsWith("agent.")) {
    return (
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent" title="Nimbus">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
    );
  }
  const member = membersById.get(event.actorId);
  return <Avatar member={member ?? { name: event.actorName || "Unknown", color: FALLBACK_COLOR }} size={28} />;
}

export function ActivityRow({ event, membersById, itemsById }: { event: ActivityEvent; membersById: Map<string, Member>; itemsById: Map<string, Item> }) {
  const link = activityLink(event, itemsById);
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <ActorAvatar event={event} membersById={membersById} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-5 text-text">{event.message}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-text-tertiary">
          <span>{typeLabel(event.type)}</span>
          <span aria-hidden>·</span>
          <time dateTime={event.createdAt} title={formatDateTime(event.createdAt)}>
            {formatRelative(event.createdAt)}
          </time>
          {link && (
            <>
              <span aria-hidden>·</span>
              <Link href={link.href} className="inline-flex items-center gap-0.5 text-accent hover:underline">
                {link.label}
                <ArrowRight className="h-3 w-3" />
              </Link>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

export function ActivityFeed({ groups, membersById, itemsById }: { groups: ActivityDayGroup[]; membersById: Map<string, Member>; itemsById: Map<string, Item> }) {
  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => (
        <section key={g.key}>
          <div className="mb-2 flex items-baseline gap-2 px-0.5">
            <h2 className="text-[13.5px] font-semibold text-text">{g.label}</h2>
            <span className="text-[12px] text-text-tertiary">
              {g.events.length} {g.events.length === 1 ? "event" : "events"}
            </span>
          </div>
          <ul className="card divide-y divide-border">
            {g.events.map((e) => (
              <ActivityRow key={e.id} event={e} membersById={membersById} itemsById={itemsById} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
