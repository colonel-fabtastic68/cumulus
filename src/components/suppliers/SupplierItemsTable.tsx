"use client";

import Link from "next/link";
import { Boxes, Sparkles } from "lucide-react";
import type { Item, Supplier } from "@/lib/types";
import { isLowStock, reorderQty } from "@/lib/inventory";
import { formatMoney, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Button, EmptyState, SimpleTable } from "@/components/ui";
import { formatLeadTime, type SupplierStats } from "./supplierUtils";

interface SupplierItemsTableProps {
  supplier: Supplier;
  stats: SupplierStats;
  currency: string;
  onDraftEmail: () => void;
}

/** "Items from this supplier" block inside the supplier drawer. */
export function SupplierItemsTable({ supplier, stats, currency, onDraftEmail }: SupplierItemsTableProps) {
  const { items, lowItems } = stats;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[13.5px] font-semibold text-text">Items from this supplier</h3>
          {items.length > 0 && <span className="text-[12px] text-text-tertiary">{items.length}</span>}
          {lowItems.length > 0 && <Badge tone="warning">{lowItems.length} below minimum</Badge>}
        </div>
        <Button size="sm" icon={<Sparkles />} onClick={onDraftEmail} disabled={items.length === 0} title={items.length === 0 ? "Assign items to this supplier first" : undefined}>
          Draft reorder email
        </Button>
      </div>
      {items.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-border">
          <EmptyState
            icon={<Boxes />}
            title="No items yet"
            description={`Set the supplier to ${supplier.name} on an item and it will show up here with its reorder details.`}
            action={
              <Button size="sm" href="/inventory">
                Go to inventory
              </Button>
            }
            className="py-8"
          />
        </div>
      ) : (
        <SimpleTable>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th className="text-right">On hand</th>
              <th className="text-right">Min</th>
              <th className="text-right">Reorder</th>
              <th className="text-right">Unit cost</th>
              <th className="text-right">Lead time</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <SupplierItemRow key={item.id} item={item} supplier={supplier} currency={currency} />
            ))}
          </tbody>
        </SimpleTable>
      )}
      {items.length > 0 && <p className="mt-1.5 text-[12px] text-text-tertiary">Reorder brings each item back up to its maximum. Lead times fall back to the supplier&apos;s default when an item has none.</p>}
    </div>
  );
}

function SupplierItemRow({ item, supplier, currency }: { item: Item; supplier: Supplier; currency: string }) {
  const low = isLowStock(item);
  const reorder = reorderQty(item);
  const usesSupplierLead = item.leadTimeDays === undefined && supplier.leadTimeDays !== undefined;
  return (
    <tr className={cn(item.status !== "active" && "text-text-tertiary")}>
      <td className="whitespace-nowrap align-middle">
        <Link href={"/inventory/" + item.id} className="font-mono text-[12px] text-accent hover:underline">
          {item.sku}
        </Link>
        {item.supplierSku && <div className="font-mono text-[11px] text-text-tertiary">{item.supplierSku}</div>}
      </td>
      <td className="align-middle">
        <span className="block max-w-[180px] truncate" title={item.name}>
          {item.name}
        </span>
        {item.status !== "active" && <span className="text-[11.5px] capitalize">{item.status}</span>}
      </td>
      <td className={cn("whitespace-nowrap text-right align-middle tabular", low && "font-medium text-warning")}>{formatQty(item.onHand, item.unit)}</td>
      <td className="whitespace-nowrap text-right align-middle tabular text-text-secondary">{item.minQty !== undefined ? formatQty(item.minQty, item.unit) : "—"}</td>
      <td className={cn("whitespace-nowrap text-right align-middle tabular", reorder > 0 && low ? "font-medium text-text" : "text-text-secondary")}>{reorder > 0 ? formatQty(reorder, item.unit) : "—"}</td>
      <td className="whitespace-nowrap text-right align-middle tabular">{formatMoney(item.unitCost, currency)}</td>
      <td className="whitespace-nowrap text-right align-middle tabular text-text-secondary">
        {formatLeadTime(item.leadTimeDays ?? supplier.leadTimeDays)}
        {usesSupplierLead && <span className="ml-1 text-[11px] text-text-tertiary">default</span>}
      </td>
    </tr>
  );
}
