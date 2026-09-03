"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Layers } from "lucide-react";
import type { Item } from "@/lib/types";
import { whereUsed, whereUsedDeep } from "@/lib/inventory";
import { formatQty } from "@/lib/format";
import { Badge, EmptyState, StatusBadge, Table, type Column } from "@/components/ui";
import { itemHref } from "./utils";

interface ParentRow {
  assembly: Item;
  qtyPer: number;
}

export function WhereUsedTab({ item, items }: { item: Item; items: Item[] }) {
  const direct = useMemo(() => whereUsed(items, item.id), [items, item.id]);
  const ancestors = useMemo(() => {
    const directIds = new Set(direct.map((d) => d.assembly.id));
    return whereUsedDeep(items, item.id).filter((a) => !directIds.has(a.id));
  }, [items, item.id, direct]);

  const columns: Column<ParentRow>[] = [
    {
      key: "sku",
      header: "Assembly",
      sortValue: (r) => r.assembly.sku,
      render: (r) => (
        <Link href={itemHref(r.assembly.id)} className="font-mono text-[12px] font-medium text-text hover:text-accent">
          {r.assembly.sku}
        </Link>
      ),
    },
    { key: "name", header: "Name", sortValue: (r) => r.assembly.name, render: (r) => <span className="text-text">{r.assembly.name}</span> },
    { key: "qtyPer", header: "Qty per", align: "right", sortValue: (r) => r.qtyPer, render: (r) => formatQty(r.qtyPer, item.unit) },
    { key: "onHand", header: "Parent on hand", align: "right", hideBelow: "sm", sortValue: (r) => r.assembly.onHand, render: (r) => formatQty(r.assembly.onHand, r.assembly.unit) },
    { key: "status", header: "Status", sortValue: (r) => r.assembly.status, render: (r) => <StatusBadge status={r.assembly.status} /> },
  ];

  if (direct.length === 0) {
    return <EmptyState icon={<Layers />} title="Not used in any assembly" description={`${item.sku} does not appear on any bill of materials.`} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Direct parents</h4>
        <Table rows={direct} columns={columns} rowKey={(r) => r.assembly.id} defaultSort={{ key: "sku", dir: "asc" }} dense />
      </div>
      {ancestors.length > 0 && (
        <div>
          <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Also used further up</h4>
          <p className="mb-2 text-[12.5px] text-text-secondary">These assemblies include {item.sku} through a sub-assembly.</p>
          <div className="flex flex-wrap gap-1.5">
            {ancestors.map((a) => (
              <Link key={a.id} href={itemHref(a.id)} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-1 text-[12.5px] hover:bg-surface-hover">
                <span className="font-mono text-[12px] text-text">{a.sku}</span>
                <span className="text-text-secondary">{a.name}</span>
                {a.status !== "active" && <Badge tone={a.status === "superseded" ? "warning" : "default"}>{a.status}</Badge>}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
