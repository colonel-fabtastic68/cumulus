"use client";

import { useMemo, useState } from "react";
import { MessageSquare, Sparkles } from "lucide-react";
import type { AgentSession, Member } from "@/lib/types";
import { Avatar, Button, EmptyState, SearchField, Table, type Column } from "@/components/ui";
import { useCollection } from "@/lib/store/provider";
import { useAgent } from "@/components/agent/AgentProvider";
import { formatDateTime, formatNumber, formatRelative, pluralize } from "@/lib/format";
import { matches } from "@/lib/utils";

const FALLBACK_COLOR = "#8a8a8a";

function messageCount(s: AgentSession): number {
  return Array.isArray(s.messages) ? s.messages.length : 0;
}

export function ConversationsTable() {
  const sessions = useCollection("agentSessions");
  const members = useCollection("members");
  const { open, openSession } = useAgent();
  const [query, setQuery] = useState("");

  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const rows = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return query.trim() ? sorted.filter((s) => matches(query, s.title, s.createdByName)) : sorted;
  }, [sessions, query]);

  const columns = useMemo<Column<AgentSession>[]>(
    () => [
      {
        key: "title",
        header: "Title",
        sortValue: (s) => s.title,
        render: (s) => (
          <span className="flex min-w-0 items-center gap-2">
            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
            <span className="truncate font-medium text-text">{s.title || "Conversation"}</span>
          </span>
        ),
      },
      {
        key: "startedBy",
        header: "Started by",
        width: "220px",
        sortValue: (s) => membersById.get(s.createdBy)?.name ?? s.createdByName,
        render: (s) => {
          const member: Pick<Member, "name" | "color"> = membersById.get(s.createdBy) ?? { name: s.createdByName || "Teammate", color: FALLBACK_COLOR };
          return (
            <span className="flex items-center gap-2">
              <Avatar member={member} size={22} />
              <span className="truncate text-text-secondary">{member.name}</span>
            </span>
          );
        },
      },
      {
        key: "messages",
        header: "Messages",
        align: "right",
        width: "110px",
        hideBelow: "sm",
        sortValue: messageCount,
        render: (s) => formatNumber(messageCount(s)),
      },
      {
        key: "updated",
        header: "Updated",
        align: "right",
        width: "130px",
        sortValue: (s) => s.updatedAt,
        render: (s) => (
          <span className="text-text-secondary" title={formatDateTime(s.updatedAt)}>
            {formatRelative(s.updatedAt)}
          </span>
        ),
      },
    ],
    [membersById],
  );

  return (
    <Table
      rows={rows}
      columns={columns}
      rowKey={(s) => s.id}
      onRowClick={(s) => openSession(s.id)}
      defaultSort={{ key: "updated", dir: "desc" }}
      pageSize={25}
      toolbar={
        <div className="flex w-full flex-wrap items-center gap-2">
          <SearchField value={query} onChange={setQuery} placeholder="Search conversations" className="w-full sm:w-64" />
          <span className="ml-auto text-[12.5px] text-text-tertiary">{pluralize(rows.length, "conversation")}</span>
        </div>
      }
      footer={sessions.length ? `${pluralize(sessions.length, "conversation")} shared with the workspace` : undefined}
      emptyState={
        sessions.length === 0 ? (
          <EmptyState
            icon={<Sparkles />}
            title="No conversations yet"
            description="Every chat with the agent is saved here so teammates can see what was asked and what changed. Start with a quick task above, or just ask."
            action={
              <Button variant="primary" size="sm" icon={<Sparkles />} onClick={() => open()}>
                Start a conversation
              </Button>
            }
            className="py-6"
          />
        ) : (
          <EmptyState title="No matches" description="Try a different search." className="py-6" />
        )
      }
    />
  );
}
