"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import type { ActivityEvent, Item, Member } from "@/lib/types";
import { Avatar } from "@/components/ui";
import { formatDateTime, formatRelative } from "@/lib/format";
import { activityLink, typeLabel, type ActivityDayGroup } from "./activityUtils";

const FALLBACK_COLOR = "#8a8a8a";

function ActorAvatar({ event, membersById }: { event: ActivityEvent; membersById: Map<string, Member> }) {
  if (event.type.startsWith("agent.")) {
    return (
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent" title="Strato">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
    );
  }
  const member = membersById.get(event.actorId);
  return <Avatar member={member ?? { name: event.actorName || "Unknown", color: FALLBACK_COLOR }} size={28} />;
}

interface ChangeLine {
  sku: string;
  field: string;
  from: unknown;
  to: unknown;
}

const show = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** The before/after lines a bulk change recorded, for auditing what exactly moved. */
function ChangeDetails({ changes, total, reason }: { changes: ChangeLine[]; total: number; reason?: string }) {
  const [open, setOpen] = useState(false);
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <div className="mt-1.5">
      <button type="button" className="inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Icon className="h-3 w-3" />
        {open ? "Hide details" : `Show details (${total} change${total === 1 ? "" : "s"})`}
      </button>
      {open && (
        <div className="mt-2 overflow-x-auto rounded-[var(--radius)] border border-border">
          <table className="w-full text-[12px]">
            <thead className="bg-surface-subdued text-[11px] uppercase tracking-wide text-text-tertiary">
              <tr>
                <th className="px-2 py-1 text-left">SKU</th>
                <th className="px-2 py-1 text-left">Field</th>
                <th className="px-2 py-1 text-right">Before</th>
                <th className="px-2 py-1 text-right">After</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((c, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-2 py-1 font-mono">{c.sku}</td>
                  <td className="px-2 py-1 text-text-secondary">{c.field}</td>
                  <td className="px-2 py-1 text-right tabular text-text-secondary">{show(c.from)}</td>
                  <td className="px-2 py-1 text-right tabular font-medium text-text">{show(c.to)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(reason || total > changes.length) && (
            <div className="border-t border-border bg-surface-subdued px-2 py-1 text-[11.5px] text-text-tertiary">
              {reason ? `Reason: ${reason}` : ""}
              {reason && total > changes.length ? " · " : ""}
              {total > changes.length ? `Showing the first ${changes.length} of ${total}; the rest were applied the same way.` : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ActivityRow({ event, membersById, itemsById }: { event: ActivityEvent; membersById: Map<string, Member>; itemsById: Map<string, Item> }) {
  const link = activityLink(event, itemsById);
  const changes = Array.isArray(event.meta?.changes) ? (event.meta!.changes as ChangeLine[]) : [];
  const changesTotal = typeof event.meta?.changesTotal === "number" ? (event.meta.changesTotal as number) : changes.length;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <ActorAvatar event={event} membersById={membersById} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-5 text-text">{event.message}</p>
        {changes.length > 0 && <ChangeDetails changes={changes} total={changesTotal} reason={typeof event.meta?.reason === "string" ? event.meta.reason : undefined} />}
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
