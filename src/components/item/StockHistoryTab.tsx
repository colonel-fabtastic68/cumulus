"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { History } from "lucide-react";
import type { Build, Item, Member, MovementType, Receipt, RefType, Rma, SalesOrder, StockMovement } from "@/lib/types";
import { formatDate, formatDateTime, formatQty, pluralize } from "@/lib/format";
import { cn, matches } from "@/lib/utils";
import { Badge, EmptyState, SearchField, Select, Table, type Column } from "@/components/ui";
import { MOVEMENT_LABELS, MOVEMENT_TYPES, REF_LABELS, isBackDated, movementTone, refHref } from "./utils";

export interface HistoryLookups {
  receipts: Receipt[];
  builds: Build[];
  orders: SalesOrder[];
  rmas: Rma[];
  membersById: Map<string, Member>;
}

interface RefInfo {
  label: string;
  href: string | null;
}

export function StockHistoryTab({ item, movements, lookups }: { item: Item; movements: StockMovement[]; lookups: HistoryLookups }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState<"" | MovementType>("");

  const numbers = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of lookups.receipts) m.set(r.id, r.number);
    for (const b of lookups.builds) m.set(b.id, b.number);
    for (const o of lookups.orders) m.set(o.id, o.number);
    for (const r of lookups.rmas) m.set(r.id, r.number);
    return m;
  }, [lookups.receipts, lookups.builds, lookups.orders, lookups.rmas]);

  const refInfo = (m: StockMovement): RefInfo | null => {
    if (!m.refType && !m.refId) return null;
    const number = m.refId ? numbers.get(m.refId) : undefined;
    const label = number ?? (m.refType ? REF_LABELS[m.refType as RefType] : undefined) ?? m.refId ?? "";
    return { label, href: refHref(m.refType, m.refId) };
  };

  const rows = useMemo(() => {
    const sorted = [...movements].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt));
    return sorted.filter((m) => {
      if (type && m.type !== type) return false;
      if (!q.trim()) return true;
      const by = lookups.membersById.get(m.createdBy)?.name;
      return matches(q, m.reason, m.note, MOVEMENT_LABELS[m.type], m.refId ? numbers.get(m.refId) : undefined, by);
    });
  }, [movements, type, q, numbers, lookups.membersById]);

  const columns: Column<StockMovement>[] = [
    {
      key: "date",
      header: "Date",
      width: "150px",
      sortValue: (m) => m.occurredAt,
      render: (m) => (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span title={formatDateTime(m.occurredAt)}>{formatDate(m.occurredAt)}</span>
          {isBackDated(m) && (
            <span title={`Recorded ${formatDateTime(m.createdAt)}`}>
              <Badge tone="warning">Back-dated</Badge>
            </span>
          )}
        </span>
      ),
    },
    { key: "type", header: "Type", sortValue: (m) => m.type, render: (m) => <Badge tone={movementTone(m.type)}>{MOVEMENT_LABELS[m.type]}</Badge> },
    {
      key: "qty",
      header: "Qty",
      align: "right",
      sortValue: (m) => m.qty,
      render: (m) => (
        <span className={cn("font-medium", m.qty > 0 ? "text-success" : m.qty < 0 ? "text-critical" : "text-text-tertiary")}>
          {m.qty > 0 ? "+" : m.qty < 0 ? "−" : ""}
          {formatQty(Math.abs(m.qty), item.unit)}
        </span>
      ),
    },
    { key: "balance", header: "Balance after", align: "right", sortValue: (m) => m.balanceAfter, render: (m) => formatQty(m.balanceAfter, item.unit) },
    {
      key: "ref",
      header: "Reference",
      hideBelow: "sm",
      sortValue: (m) => (m.refId ? numbers.get(m.refId) : undefined) ?? m.refType ?? "",
      render: (m) => {
        const r = refInfo(m);
        if (!r) return <span className="text-text-tertiary">—</span>;
        return r.href ? (
          <Link href={r.href} className="font-mono text-[12px] text-accent hover:underline">
            {r.label}
          </Link>
        ) : (
          <span className="text-[12.5px] text-text-secondary">{r.label}</span>
        );
      },
    },
    {
      key: "reason",
      header: "Reason / note",
      hideBelow: "md",
      render: (m) => {
        const text = [m.reason, m.note].filter(Boolean).join(" · ");
        return text ? <span className="block max-w-[320px] truncate text-text-secondary" title={text}>{text}</span> : <span className="text-text-tertiary">—</span>;
      },
    },
    {
      key: "by",
      header: "By",
      hideBelow: "lg",
      sortValue: (m) => lookups.membersById.get(m.createdBy)?.name ?? m.createdBy,
      render: (m) => <span className="text-text-secondary">{lookups.membersById.get(m.createdBy)?.name ?? (m.createdBy === "agent" ? "Agent" : m.createdBy || "—")}</span>,
    },
  ];

  if (movements.length === 0) {
    return <EmptyState icon={<History />} title="No stock movements yet" description="Receipts, builds, sales, counts and write-offs will show up here as they happen." />;
  }

  return (
    <Table
      rows={rows}
      columns={columns}
      rowKey={(m) => m.id}
      defaultSort={{ key: "date", dir: "desc" }}
      pageSize={25}
      dense
      toolbar={
        <div className="flex w-full flex-wrap items-center gap-2">
          <SearchField value={q} onChange={setQ} placeholder="Search reason, note or reference" className="w-full sm:w-64" />
          <Select
            value={type}
            onChange={(e) => setType(e.target.value as "" | MovementType)}
            placeholder="All types"
            options={MOVEMENT_TYPES.map((t) => ({ value: t, label: MOVEMENT_LABELS[t] }))}
            containerClassName="w-44"
          />
          <span className="ml-auto text-[12.5px] text-text-tertiary">{pluralize(rows.length, "movement")}</span>
        </div>
      }
      emptyState={<span>No movements match these filters.</span>}
    />
  );
}
