"use client";

import { ClipboardList, Sparkles } from "lucide-react";
import type { ActivityEvent, Member } from "@/lib/types";
import { formatRelative } from "@/lib/format";
import { Avatar, Card } from "@/components/ui";
import { CardLink, CardTitle } from "./CardTitle";

export function RecentActivityCard({ events, membersById }: { events: ActivityEvent[]; membersById: Map<string, Member> }) {
  return (
    <Card padded={false}>
      <div className="px-4 pt-4 pb-3">
        <CardTitle icon={<ClipboardList />} title="Recent activity" action={<CardLink href="/activity">All activity</CardLink>} />
      </div>
      {events.length === 0 ? (
        <p className="px-4 pb-4 text-[13px] text-text-secondary">No activity yet. Changes made by your team and Nimbus will appear here.</p>
      ) : (
        <ul className="border-t border-border">
          {events.map((e) => {
            const member = membersById.get(e.actorId);
            const isAgent = e.type === "agent.action";
            return (
              <li key={e.id} className="flex items-start gap-2.5 px-4 py-2 text-[12.5px]">
                {isAgent ? (
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                    <Sparkles className="h-3.5 w-3.5" />
                  </span>
                ) : (
                  <Avatar member={member ?? { name: e.actorName, color: "#8a8a8a" }} size={24} className="mt-0.5" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 leading-[1.4] text-text">{e.message}</p>
                  <p className="text-[11.5px] text-text-tertiary" title={e.createdAt}>
                    {formatRelative(e.createdAt)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
