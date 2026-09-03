"use client";

import { useMemo } from "react";
import type { Member, MemberRole } from "@/lib/types";
import { Avatar, Badge, Card, CardHeader } from "@/components/ui";
import { isOnline, useCurrentUser } from "@/lib/auth";
import { ROLE_DESCRIPTIONS, ROLE_OPTIONS, roleLabel } from "./teamUtils";

/** Members seen in the last couple of minutes, current user first. */
export function OnlineCard({ members }: { members: Member[] }) {
  const user = useCurrentUser();
  const online = useMemo(() => {
    const list = members.filter((m) => isOnline(m));
    return list.sort((a, b) => (a.id === user.id ? -1 : b.id === user.id ? 1 : a.name.localeCompare(b.name)));
  }, [members, user.id]);

  return (
    <Card>
      <CardHeader title="Who is online" subtitle={online.length === 0 ? "No one is online right now." : `${online.length} ${online.length === 1 ? "person" : "people"} active in the last few minutes`} />
      {online.length > 0 && (
        <ul className="flex flex-col gap-2">
          {online.map((m) => (
            <li key={m.id} className="flex items-center gap-2.5">
              <Avatar member={m} size={26} online />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium text-text">{m.name}</span>
                  {m.id === user.id && <Badge tone="accent">You</Badge>}
                </div>
                <div className="text-[12px] text-text-tertiary">{roleLabel(m.role)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const ROLE_TONES: Record<MemberRole, "accent" | "info" | "success" | "default"> = {
  owner: "accent",
  admin: "info",
  member: "success",
  viewer: "default",
};

/** One line per role so the team knows what each level can do. */
export function RolesCard() {
  return (
    <Card>
      <CardHeader title="Roles" subtitle="What each role can do." />
      <dl className="flex flex-col gap-3">
        {ROLE_OPTIONS.map((r) => (
          <div key={r.value}>
            <dt>
              <Badge tone={ROLE_TONES[r.value]}>{r.label}</Badge>
            </dt>
            <dd className="mt-1 text-[12.5px] leading-[1.45] text-text-secondary">{ROLE_DESCRIPTIONS[r.value]}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
