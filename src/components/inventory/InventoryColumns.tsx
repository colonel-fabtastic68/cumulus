"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Item } from "@/lib/types";
import { isLowStock } from "@/lib/inventory";
import { formatMoney, formatNumber, formatQty, formatRelative } from "@/lib/format";
import { clamp, cn } from "@/lib/utils";
import { Badge, StatusBadge, type Column } from "@/components/ui";

/** On-hand quantity with a "Low" flag and a tiny min/max level bar. */
export function StockLevelCell({ item }: { item: Item }) {
  const low = isLowStock(item);
  const hasMin = item.minQty !== undefined;
  const cap = item.maxQty !== undefined && item.maxQty > 0 ? item.maxQty : hasMin ? Math.max(1, item.minQty! * 2) : 0;
  const pct = cap > 0 ? clamp((item.onHand / cap) * 100, 0, 100) : 0;
  const minPct = cap > 0 && hasMin ? clamp((item.minQty! / cap) * 100, 0, 100) : 0;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center justify-end gap-1.5">
        {low && <Badge tone="warning">Low</Badge>}
        <span className={cn("font-medium", low ? "text-warning" : "text-text")}>{formatQty(item.onHand, item.unit)}</span>
      </div>
      {hasMin && (
        <div
          className="relative h-1 w-16 overflow-hidden rounded-full bg-surface-hover"
          title={`Min ${formatNumber(item.minQty!)}${item.maxQty !== undefined ? ` · Max ${formatNumber(item.maxQty)}` : ""}`}
          aria-hidden
        >
          <div className={cn("h-full rounded-full", low ? "bg-warning" : "bg-success")} style={{ width: `${pct}%` }} />
          {minPct > 0 && minPct < 100 && <div className="absolute inset-y-0 w-px bg-border-strong" style={{ left: `${minPct}%` }} />}
        </div>
      )}
    </div>
  );
}

function optionalNumber(n?: number): string {
  return n === undefined ? "—" : formatNumber(n, Number.isInteger(n) ? 0 : 2);
}

export function useInventoryColumns({ currency, supplierName }: { currency: string; supplierName: (id?: string) => string | undefined }): Column<Item>[] {
  return useMemo<Column<Item>[]>(
    () => [
      {
        key: "sku",
        header: "SKU",
        width: "24%",
        sortValue: (i) => i.sku,
        render: (i) => (
          <div className="min-w-0 max-w-[280px]">
            <Link href={"/inventory/" + i.id} onClick={(e) => e.stopPropagation()} className="font-mono text-[12px] font-medium text-text hover:text-accent">
              {i.sku}
            </Link>
            <div className="truncate text-[12.5px] text-text-secondary" title={i.name}>
              {i.name}
            </div>
          </div>
        ),
      },
      {
        key: "category",
        header: "Category",
        sortValue: (i) => i.category ?? "",
        render: (i) => (i.category ? <span>{i.category}</span> : <span className="text-text-tertiary">—</span>),
      },
      {
        key: "type",
        header: "Type",
        sortValue: (i) => i.type,
        render: (i) => <Badge tone={i.type === "assembly" ? "info" : "default"}>{i.type === "assembly" ? "Assembly" : "Part"}</Badge>,
      },
      {
        key: "onHand",
        header: "On hand",
        align: "right",
        sortValue: (i) => i.onHand,
        render: (i) => <StockLevelCell item={i} />,
      },
      {
        key: "minMax",
        header: "Min / Max",
        align: "right",
        sortValue: (i) => i.minQty ?? null,
        render: (i) => (
          <span className={i.minQty === undefined && i.maxQty === undefined ? "text-text-tertiary" : "text-text-secondary"}>
            {optionalNumber(i.minQty)} / {optionalNumber(i.maxQty)}
          </span>
        ),
      },
      {
        key: "unitCost",
        header: "Unit cost",
        align: "right",
        sortValue: (i) => i.unitCost,
        render: (i) => formatMoney(i.unitCost, currency),
      },
      {
        key: "price",
        header: "Price",
        align: "right",
        sortValue: (i) => i.price,
        render: (i) => formatMoney(i.price, currency),
      },
      {
        key: "value",
        header: "Value",
        align: "right",
        sortValue: (i) => i.onHand * i.unitCost,
        render: (i) => <span className="font-medium">{formatMoney(i.onHand * i.unitCost, currency)}</span>,
      },
      {
        key: "supplier",
        header: "Supplier",
        hideBelow: "lg",
        sortValue: (i) => supplierName(i.supplierId) ?? "",
        render: (i) => {
          const name = supplierName(i.supplierId);
          return name ? <span className="block max-w-[160px] truncate">{name}</span> : <span className="text-text-tertiary">—</span>;
        },
      },
      {
        key: "leadTime",
        header: "Lead time",
        align: "right",
        hideBelow: "lg",
        sortValue: (i) => i.leadTimeDays ?? null,
        render: (i) => (i.leadTimeDays === undefined ? <span className="text-text-tertiary">—</span> : `${formatNumber(i.leadTimeDays)}d`),
      },
      {
        key: "status",
        header: "Status",
        sortValue: (i) => i.status,
        render: (i) => <StatusBadge status={i.status} />,
      },
      {
        key: "updated",
        header: "Updated",
        hideBelow: "md",
        sortValue: (i) => i.updatedAt,
        render: (i) => <span className="whitespace-nowrap text-text-secondary">{formatRelative(i.updatedAt)}</span>,
      },
    ],
    [currency, supplierName],
  );
}
