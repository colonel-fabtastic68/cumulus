"use client";

import { useMemo } from "react";
import { Users } from "lucide-react";
import type { Member } from "@/lib/types";
import { isOnline, useCurrentUser } from "@/lib/auth";
import { Avatar, Badge, Card } from "@/components/ui";
import { CardLink, CardTitle } from "./CardTitle";

export function TeamCard({ members }: { members: Member[] }) {
  const user = useCurrentUser();
  const rows = useMemo(() => {
    const withPresence = members.map((m) => ({ member: m, online: isOnline(m) }));
    return withPresence.sort((a, b) => Number(b.online) - Number(a.online) || a.member.name.localeCompare(b.member.name));
  }, [members]);
  const onlineCount = rows.filter((r) => r.online).length;

  return (
    <Card>
      <CardTitle
        icon={<Users />}
        title="Team"
        meta={<span className="text-[12.5px] text-text-tertiary">{onlineCount} online</span>}
        action={<CardLink href="/team">Manage</CardLink>}
      />
      {rows.length === 0 ? (
        <p className="mt-3 text-[13px] text-text-secondary">No teammates yet.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {rows.map(({ member: m, online }) => (
            <li key={m.id} className="flex items-center gap-2.5 text-[13px]">
              <Avatar member={m} size={26} online={online} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-medium text-text">{m.name}</span>
                  {m.id === user.id && <span className="text-[11.5px] text-text-tertiary">(you)</span>}
                </div>
                <div className="text-[11.5px] text-text-tertiary">{online ? "Online now" : m.lastSeenAt ? `Seen ${new Date(m.lastSeenAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Never signed in"}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Badge tone={m.role === "owner" ? "accent" : "default"}>{m.role}</Badge>
                {m.status === "invited" && <Badge tone="info">Invited</Badge>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
