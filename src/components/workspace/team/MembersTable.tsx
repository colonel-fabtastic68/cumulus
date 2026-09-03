"use client";

import { useMemo, useState } from "react";
import { MoreHorizontal, UserMinus, Users } from "lucide-react";
import type { Member, MemberRole } from "@/lib/types";
import { Avatar, Badge, ConfirmDialog, EmptyState, IconButton, Menu, SearchField, Segmented, Select, StatusBadge, Table, useToast, type Column } from "@/components/ui";
import { useStore } from "@/lib/store/provider";
import { isOnline, useCurrentUser } from "@/lib/auth";
import { formatDateTime, formatRelative } from "@/lib/format";
import { matches } from "@/lib/utils";
import { ROLE_OPTIONS, canManageTeam, roleLabel } from "./teamUtils";

type StatusFilter = "all" | "active" | "invited";

export function MembersTable({ members, onInvite }: { members: Member[]; onInvite?: () => void }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const canManage = canManageTeam(user);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [removing, setRemoving] = useState<Member | null>(null);
  const [busy, setBusy] = useState(false);

  const ownerCount = useMemo(() => members.filter((m) => m.role === "owner").length, [members]);
  const isLastOwner = (m: Member) => m.role === "owner" && ownerCount <= 1;

  const counts = useMemo(
    () => ({
      all: members.length,
      active: members.filter((m) => m.status === "active").length,
      invited: members.filter((m) => m.status === "invited").length,
    }),
    [members],
  );

  const rows = useMemo(
    () => members.filter((m) => (status === "all" || m.status === status) && matches(query, m.name, m.email, roleLabel(m.role))),
    [members, status, query],
  );

  const changeRole = async (m: Member, role: MemberRole) => {
    if (role === m.role) return;
    try {
      await store.patch("members", m.id, { role });
      toast(`${m.name} is now ${role === "owner" || role === "admin" ? "an" : "a"} ${roleLabel(role).toLowerCase()}`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not change the role", "critical");
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await store.remove("members", removing.id);
      toast(`Removed ${removing.name} from the workspace`, "success");
      setRemoving(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove the member", "critical");
    } finally {
      setBusy(false);
    }
  };

  const columns = useMemo<Column<Member>[]>(() => {
    const cols: Column<Member>[] = [
      {
        key: "name",
        header: "Member",
        render: (m) => (
          <div className="flex min-w-0 items-center gap-2.5">
            <Avatar member={m} size={28} online={isOnline(m)} />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-medium text-text">{m.name}</span>
                {m.id === user.id && <Badge tone="accent">You</Badge>}
              </div>
              <div className="truncate text-[12px] text-text-tertiary sm:hidden">{m.email || "—"}</div>
            </div>
          </div>
        ),
        sortValue: (m) => m.name,
      },
      {
        key: "email",
        header: "Email",
        render: (m) => (m.email ? <span className="text-text-secondary">{m.email}</span> : <span className="text-text-tertiary">—</span>),
        sortValue: (m) => m.email,
        hideBelow: "sm",
      },
      {
        key: "role",
        header: "Role",
        width: "150px",
        render: (m) => {
          const editable = canManage && !isLastOwner(m);
          if (!editable) {
            return (
              <span className="text-text" title={isLastOwner(m) ? "The last owner cannot be changed" : undefined}>
                {roleLabel(m.role)}
              </span>
            );
          }
          if (m.id === user.id) {
            return (
              <span className="text-text" title="Ask another owner or admin to change your own role">
                {roleLabel(m.role)}
              </span>
            );
          }
          return (
            <Select
              aria-label={`Role for ${m.name}`}
              value={m.role}
              options={ROLE_OPTIONS}
              onChange={(e) => void changeRole(m, e.target.value as MemberRole)}
              containerClassName="w-[118px]"
              className="h-7 text-[12.5px]"
            />
          );
        },
        sortValue: (m) => ROLE_OPTIONS.findIndex((r) => r.value === m.role),
      },
      {
        key: "status",
        header: "Status",
        width: "100px",
        render: (m) => <StatusBadge status={m.status} />,
        sortValue: (m) => m.status,
        hideBelow: "md",
      },
      {
        key: "lastSeen",
        header: "Last seen",
        width: "130px",
        className: "whitespace-nowrap",
        render: (m) => {
          const online = isOnline(m);
          return (
            <span className="inline-flex items-center gap-1.5 text-text-secondary" title={m.lastSeenAt ? formatDateTime(m.lastSeenAt) : undefined}>
              <span className={online ? "h-2 w-2 rounded-full bg-success" : "h-2 w-2 rounded-full bg-border-strong"} aria-hidden />
              {online ? <span className="text-success">Online</span> : m.lastSeenAt ? formatRelative(m.lastSeenAt) : <span className="text-text-tertiary">Never</span>}
            </span>
          );
        },
        sortValue: (m) => (m.lastSeenAt ? new Date(m.lastSeenAt).getTime() : 0),
      },
    ];
    if (canManage) {
      cols.push({
        key: "actions",
        header: "",
        width: "48px",
        align: "right",
        render: (m) => {
          const self = m.id === user.id;
          const lastOwner = isLastOwner(m);
          return (
            <Menu
              trigger={<IconButton variant="plain" size="sm" aria-label={`Actions for ${m.name}`} className="text-text-secondary"><MoreHorizontal className="h-4 w-4" /></IconButton>}
              items={[
                {
                  label: self ? "You cannot remove yourself" : lastOwner ? "Cannot remove the last owner" : "Remove from workspace",
                  icon: <UserMinus />,
                  destructive: true,
                  disabled: self || lastOwner,
                  onSelect: () => setRemoving(m),
                },
              ]}
            />
          );
        },
      });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage, ownerCount, user.id, store]);

  const emptyState =
    members.length === 0 ? (
      <EmptyState icon={<Users />} title="No members yet" description="Invite the people who receive, build and ship so every change carries a name." />
    ) : (
      <EmptyState icon={<Users />} title="No matching members" description="Try a different search or clear the status filter." />
    );

  return (
    <>
      <Table
        rows={rows}
        columns={columns}
        rowKey={(m) => m.id}
        defaultSort={{ key: "role", dir: "asc" }}
        emptyState={emptyState}
        footer={`${rows.length} of ${members.length} ${members.length === 1 ? "member" : "members"}`}
        toolbar={
          <div className="flex w-full flex-wrap items-center gap-2">
            <SearchField value={query} onChange={setQuery} placeholder="Search name or email" className="w-full sm:w-64" />
            <Segmented
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "All", count: counts.all },
                { value: "active", label: "Active", count: counts.active },
                { value: "invited", label: "Invited", count: counts.invited },
              ]}
            />
            {onInvite && canManage && members.length === 0 && (
              <button type="button" onClick={onInvite} className="ml-auto text-[12.5px] text-accent hover:underline">
                Invite someone
              </button>
            )}
          </div>
        }
      />
      <ConfirmDialog
        open={!!removing}
        onClose={() => (busy ? undefined : setRemoving(null))}
        onConfirm={() => void confirmRemove()}
        title={removing ? `Remove ${removing.name}?` : "Remove member"}
        message={
          removing ? (
            <>
              {removing.name} ({removing.email || "no email"}) will lose access to this workspace. Activity they recorded stays in the log.
            </>
          ) : null
        }
        confirmLabel="Remove"
        destructive
        loading={busy}
      />
    </>
  );
}
