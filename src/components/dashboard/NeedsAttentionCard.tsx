"use client";

import { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { LowStockRow } from "@/lib/inventory";
import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Card, Table, type Column } from "@/components/ui";
import { CardLink, CardTitle } from "./CardTitle";

const MAX_ROWS = 8;

export function NeedsAttentionCard({ rows }: { rows: LowStockRow[] }) {
  const visible = useMemo(() => rows.slice(0, MAX_ROWS), [rows]);

  const columns = useMemo<Column<LowStockRow>[]>(
    () => [
      {
        key: "sku",
        header: "SKU",
        width: "160px",
        render: (r) => (
          <Link href={"/inventory/" + r.item.id} className="font-mono text-[12px] font-medium text-accent hover:underline">
            {r.item.sku}
          </Link>
        ),
      },
      {
        key: "name",
        header: "Item",
        render: (r) => (
          <span className="block max-w-[260px] truncate text-text" title={r.item.name}>
            {r.item.name}
          </span>
        ),
      },
      {
        key: "onHand",
        header: "On hand / min",
        align: "right",
        render: (r) => (
          <span>
            <span className={cn("font-medium", r.item.onHand <= 0 ? "text-critical" : "text-warning")}>{formatQty(r.item.onHand, r.item.unit)}</span>
            <span className="text-text-tertiary"> / {formatQty(r.item.minQty ?? 0, r.item.unit)}</span>
          </span>
        ),
      },
      {
        key: "reorder",
        header: "Reorder",
        align: "right",
        render: (r) => <span className="font-medium">{formatQty(r.reorder, r.item.unit)}</span>,
      },
      {
        key: "supplier",
        header: "Supplier",
        hideBelow: "md",
        render: (r) => <span className="text-text-secondary">{r.supplier?.name ?? "—"}</span>,
      },
      {
        key: "cover",
        header: "Cover",
        align: "right",
        hideBelow: "sm",
        render: (r) => {
          if (r.daysOfCover === null) return <span className="text-text-tertiary">—</span>;
          const lead = r.item.leadTimeDays ?? r.supplier?.leadTimeDays;
          const tight = lead !== undefined && r.daysOfCover < lead;
          return (
            <span className={cn(tight ? "font-medium text-critical" : "text-text-secondary")} title={tight ? `Less than the ${lead}-day lead time` : undefined}>
              {r.daysOfCover}d
            </span>
          );
        },
      },
    ],
    [],
  );

  if (rows.length === 0) {
    return (
      <Card>
        <CardTitle icon={<AlertTriangle />} title="Needs attention" action={<CardLink href="/reports?tab=lowStock">Reorder list</CardLink>} />
        <div className="mt-3 flex items-center gap-2 rounded-[var(--radius)] bg-success-soft px-3 py-2.5 text-[13px] text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>All stocked up. Nothing is below its minimum right now.</span>
        </div>
      </Card>
    );
  }

  return (
    <Table
      rows={visible}
      columns={columns}
      rowKey={(r) => r.item.id}
      dense
      stickyHeader={false}
      toolbar={
        <CardTitle
          icon={<AlertTriangle className="text-warning" />}
          title="Needs attention"
          meta={
            <Badge tone="warning">
              {rows.length} below minimum
            </Badge>
          }
          action={<CardLink href="/inventory?filter=low">View in inventory</CardLink>}
        />
      }
      footer={
        <div className="flex items-center gap-2">
          <CardLink href="/reports?tab=lowStock">See full reorder list</CardLink>
          {rows.length > visible.length && <span className="text-text-tertiary">{rows.length - visible.length} more not shown</span>}
        </div>
      }
    />
  );
}
