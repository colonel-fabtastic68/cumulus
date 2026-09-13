"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { ActivityEvent, Item, Member, Supplier } from "@/lib/types";
import { formatDate, formatDateTime, formatRelative } from "@/lib/format";
import { Avatar, Card, CardHeader, DescriptionList, StatusBadge } from "@/components/ui";
import { itemHref } from "./utils";
import { SuppliersCard } from "./SuppliersCard";

export function ItemAside({ item, items, suppliers, currency, canEdit, membersById, activity }: { item: Item; items: Item[]; suppliers: Supplier[]; currency: string; canEdit: boolean; membersById: Map<string, Member>; activity: ActivityEvent[] }) {
  const supersededBy = item.supersededBy ? items.find((i) => i.id === item.supersededBy) : undefined;
  const supersedes = useMemo(() => items.filter((i) => i.supersededBy === item.id), [items, item.id]);
  const recent = useMemo(() => activity.filter((a) => a.entityId === item.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5), [activity, item.id]);

  return (
    <>
      <SuppliersCard item={item} suppliers={suppliers} currency={currency} canEdit={canEdit} />

      {(supersededBy || supersedes.length > 0) && (
        <Card>
          <CardHeader title="Part number history" />
          <div className="flex flex-col gap-2 text-[13px]">
            {supersededBy && (
              <div>
                <div className="text-[12px] text-text-secondary">Superseded by</div>
                <Link href={itemHref(supersededBy.id)} className="inline-flex items-center gap-1.5 text-accent hover:underline">
                  <span className="font-mono text-[12.5px]">{supersededBy.sku}</span> {supersededBy.name}
                </Link>
              </div>
            )}
            {supersedes.length > 0 && (
              <div>
                <div className="text-[12px] text-text-secondary">Replaces</div>
                <ul className="mt-0.5 flex flex-col gap-1">
                  {supersedes.map((s) => (
                    <li key={s.id} className="flex items-center justify-between gap-2">
                      <Link href={itemHref(s.id)} className="min-w-0 truncate text-accent hover:underline">
                        <span className="font-mono text-[12.5px]">{s.sku}</span> {s.name}
                      </Link>
                      <StatusBadge status={s.status} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Details" />
        <DescriptionList
          rows={[
            { label: "ID", value: <span className="font-mono text-[12px] text-text-secondary">{item.id}</span> },
            { label: "Type", value: item.type === "assembly" ? "BOM (assembly)" : "Part" },
            { label: "Status", value: <StatusBadge status={item.status} /> },
            { label: "Created", value: <span title={formatDateTime(item.createdAt)}>{formatDate(item.createdAt)}</span> },
            {
              label: "Updated",
              value: (
                <span title={formatDateTime(item.updatedAt)}>
                  {formatRelative(item.updatedAt)}
                  {item.updatedBy && membersById.get(item.updatedBy) && <span className="text-text-secondary"> by {membersById.get(item.updatedBy)!.name}</span>}
                </span>
              ),
            },
          ]}
        />
      </Card>

      <Card>
        <CardHeader title="Recent activity" actions={<Link href="/activity" className="text-[12.5px] text-accent hover:underline">All activity</Link>} />
        {recent.length === 0 ? (
          <p className="text-[13px] text-text-tertiary">Nothing logged for this item yet.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {recent.map((ev) => {
              const member = membersById.get(ev.actorId);
              return (
                <li key={ev.id} className="flex items-start gap-2">
                  <Avatar member={member ?? { name: ev.actorName, color: "#8a8a8a" }} size={22} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] leading-4 text-text">{ev.message}</div>
                    <div className="text-[11.5px] text-text-tertiary" title={formatDateTime(ev.createdAt)}>
                      {formatRelative(ev.createdAt)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
