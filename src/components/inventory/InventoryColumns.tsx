"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Item } from "@/lib/types";
import { isLowStock, qtyAt } from "@/lib/inventory";
import { itemBinAt } from "@/lib/locations";
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

export interface ColumnLocation {
  id: string;
  name: string;
  homeId: string;
}

/** Factor 29: the quantity and bin at one location instead of the company total. */
function AtLocationCell({ item, location }: { item: Item; location: ColumnLocation }) {
  const qty = qtyAt(item, location.id, location.homeId);
  const bin = itemBinAt(item, location.id, location.homeId);
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={cn("font-medium", qty > 0 ? "text-text" : "text-text-tertiary")}>{formatQty(qty, item.unit)}</span>
      {bin && <span className="font-mono text-[11px] text-text-tertiary">{bin}</span>}
    </div>
  );
}

function optionalNumber(n?: number): string {
  return n === undefined ? "—" : formatNumber(n, Number.isInteger(n) ? 0 : 2);
}

export function useInventoryColumns({ currency, supplierName, location }: { currency: string; supplierName: (id?: string) => string | undefined; location?: ColumnLocation }): Column<Item>[] {
  return useMemo<Column<Item>[]>(
    () => [
      {
        key: "sku",
        header: "SKU",
        flex: true,
        minWidth: 140,
        sortValue: (i) => i.sku,
        render: (i) => (
          <div className="min-w-0">
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
        minWidth: 82,
        maxWidth: 140,
        priority: 3,
        sortValue: (i) => i.category ?? "",
        render: (i) =>
          i.category ? (
            <span className="block truncate" title={i.category}>
              {i.category}
            </span>
          ) : (
            <span className="text-text-tertiary">—</span>
          ),
      },
      {
        key: "type",
        header: "Type",
        minWidth: 92,
        maxWidth: 104,
        priority: 6,
        sortValue: (i) => i.type,
        render: (i) => <Badge tone={i.type === "assembly" ? "info" : "default"}>{i.type === "assembly" ? "Assembly" : "Part"}</Badge>,
      },
      {
        key: "onHand",
        header: location ? `At ${location.name}` : "On hand",
        minWidth: location ? 120 : 108,
        maxWidth: location ? 150 : 132,
        align: "right",
        sortValue: (i) => (location ? qtyAt(i, location.id, location.homeId) : i.onHand),
        render: (i) => (location ? <AtLocationCell item={i} location={location} /> : <StockLevelCell item={i} />),
      },
      {
        key: "minMax",
        header: "Min / Max",
        minWidth: 86,
        maxWidth: 104,
        priority: 4,
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
        minWidth: 84,
        maxWidth: 96,
        align: "right",
        sortValue: (i) => i.unitCost,
        render: (i) => formatMoney(i.unitCost, currency),
      },
      {
        key: "price",
        header: "Price",
        minWidth: 78,
        maxWidth: 92,
        priority: 7,
        align: "right",
        sortValue: (i) => i.price,
        render: (i) => formatMoney(i.price, currency),
      },
      {
        key: "value",
        header: "Value",
        minWidth: 90,
        maxWidth: 104,
        align: "right",
        sortValue: (i) => i.onHand * i.unitCost,
        render: (i) => <span className="font-medium">{formatMoney(i.onHand * i.unitCost, currency)}</span>,
      },
      {
        key: "supplier",
        header: "Supplier",
        minWidth: 94,
        maxWidth: 170,
        priority: 5,
        sortValue: (i) => supplierName(i.supplierId) ?? "",
        render: (i) => {
          const name = supplierName(i.supplierId);
          const more = (i.suppliers ?? []).filter((s) => s.supplierId !== i.supplierId).length;
          if (!name) return <span className="text-text-tertiary">—</span>;
          return (
            <span className="block truncate" title={more ? `${name} and ${more} more` : name}>
              {name}
              {more > 0 && <span className="ml-1 rounded-full bg-surface-hover px-1.5 text-[11px] text-text-secondary">+{more}</span>}
            </span>
          );
        },
      },
      {
        key: "leadTime",
        header: "Lead time",
        minWidth: 76,
        maxWidth: 90,
        priority: 2,
        align: "right",
        sortValue: (i) => i.leadTimeDays ?? null,
        render: (i) => (i.leadTimeDays === undefined ? <span className="text-text-tertiary">—</span> : `${formatNumber(i.leadTimeDays)}d`),
      },
      {
        key: "status",
        header: "Status",
        minWidth: 106,
        maxWidth: 112,
        sortValue: (i) => i.status,
        render: (i) => <StatusBadge status={i.status} />,
      },
      {
        key: "updated",
        header: "Updated",
        minWidth: 78,
        maxWidth: 96,
        priority: 1,
        sortValue: (i) => i.updatedAt,
        render: (i) => <span className="whitespace-nowrap text-text-secondary">{formatRelative(i.updatedAt)}</span>,
      },
    ],
    [currency, supplierName, location],
  );
}
