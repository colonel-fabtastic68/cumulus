"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Mail, Sparkles } from "lucide-react";
import type { ActivityEvent, Item, Member, Supplier } from "@/lib/types";
import { isLowStock, reorderQty } from "@/lib/inventory";
import { formatDate, formatDateTime, formatRelative, pluralize } from "@/lib/format";
import { Avatar, Button, Card, CardHeader, DescriptionList, StatusBadge } from "@/components/ui";
import { useAgent } from "@/components/agent/AgentProvider";
import { itemHref, supplierHref } from "./utils";

export function ItemAside({ item, items, supplier, membersById, activity }: { item: Item; items: Item[]; supplier?: Supplier; membersById: Map<string, Member>; activity: ActivityEvent[] }) {
  const { open } = useAgent();
  const supersededBy = item.supersededBy ? items.find((i) => i.id === item.supersededBy) : undefined;
  const supersedes = useMemo(() => items.filter((i) => i.supersededBy === item.id), [items, item.id]);
  const recent = useMemo(() => activity.filter((a) => a.entityId === item.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5), [activity, item.id]);
  const low = isLowStock(item);

  return (
    <>
      <Card>
        <CardHeader title="Supplier" />
        {supplier ? (
          <div className="flex flex-col gap-3">
            <DescriptionList
              rows={[
                {
                  label: "Name",
                  value: (
                    <Link href={supplierHref(supplier.id)} className="text-accent hover:underline">
                      {supplier.name}
                    </Link>
                  ),
                },
                { label: "Lead time", value: item.leadTimeDays !== undefined ? pluralize(item.leadTimeDays, "day") : supplier.leadTimeDays !== undefined ? `${pluralize(supplier.leadTimeDays, "day")} (supplier default)` : "—" },
                { label: "Terms", value: supplier.terms ?? "—" },
                { label: "Supplier SKU", value: item.supplierSku ? <span className="font-mono text-[12.5px]">{item.supplierSku}</span> : "—" },
                {
                  label: "Email",
                  value: supplier.email ? (
                    <a href={`mailto:${supplier.email}`} className="inline-flex items-center gap-1 text-accent hover:underline">
                      <Mail className="h-3 w-3" /> {supplier.email}
                    </a>
                  ) : (
                    "—"
                  ),
                },
              ]}
            />
            <Button
              size="sm"
              icon={<Sparkles />}
              onClick={() =>
                open(
                  `Draft a short reorder email to ${supplier.name} for ${item.sku} (${item.name}). We have ${item.onHand} on hand${item.minQty !== undefined ? `, minimum ${item.minQty}` : ""}${item.maxQty !== undefined ? `, maximum ${item.maxQty}` : ""}. Suggest ordering ${reorderQty(item) || "an appropriate quantity"}${item.supplierSku ? ` (their part number ${item.supplierSku})` : ""}, and ask for current lead time and pricing.`,
                  { send: true },
                )
              }
            >
              Draft reorder email
            </Button>
            {low && <p className="text-[12px] text-warning">Below minimum — reorder {reorderQty(item)} to reach {item.maxQty !== undefined ? "max" : "2× min"}.</p>}
          </div>
        ) : (
          <p className="text-[13px] text-text-tertiary">No supplier assigned. Set one from Edit to track lead times and reorder by vendor.</p>
        )}
      </Card>

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
            { label: "Type", value: item.type === "assembly" ? "Assembly" : "Part" },
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
