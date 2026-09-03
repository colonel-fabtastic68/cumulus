"use client";

import Link from "next/link";
import type { Item, Member, StockMovement, Supplier } from "@/lib/types";
import { formatDate, formatPercent, formatRelative, pluralize } from "@/lib/format";
import { Badge, DescriptionList } from "@/components/ui";
import { MovementSparkline } from "./MovementSparkline";
import { supplierHref } from "./utils";

export function OverviewTab({ item, supplier, movements, membersById }: { item: Item; supplier?: Supplier; movements: StockMovement[]; membersById: Map<string, Member> }) {
  const updatedBy = item.updatedBy ? membersById.get(item.updatedBy)?.name : undefined;
  const leadTime = item.leadTimeDays ?? supplier?.leadTimeDays;

  const rows = [
    { label: "Category", value: item.category ?? "—" },
    { label: "Unit", value: item.unit },
    { label: "Location", value: item.location ?? "—" },
    { label: "Barcode", value: item.barcode ? <span className="font-mono text-[12.5px]">{item.barcode}</span> : "—" },
    {
      label: "Supplier",
      value: supplier ? (
        <Link href={supplierHref(supplier.id)} className="text-accent hover:underline">
          {supplier.name}
        </Link>
      ) : item.supplierId ? (
        <span className="text-text-tertiary">Unknown supplier</span>
      ) : (
        "—"
      ),
    },
    { label: "Supplier SKU", value: item.supplierSku ? <span className="font-mono text-[12.5px]">{item.supplierSku}</span> : "—" },
    {
      label: "Lead time",
      value: leadTime !== undefined ? (
        <span>
          {pluralize(leadTime, "day")}
          {item.leadTimeDays === undefined && supplier?.leadTimeDays !== undefined && <span className="ml-1 text-text-tertiary">(from supplier)</span>}
        </span>
      ) : (
        "—"
      ),
    },
    { label: "Expected waste", value: item.expectedWastePct !== undefined ? formatPercent(item.expectedWastePct, 1) : "—" },
    {
      label: "Tags",
      value:
        item.tags.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {item.tags.map((t) => (
              <Badge key={t}>{t}</Badge>
            ))}
          </span>
        ) : (
          "—"
        ),
    },
    { label: "Created", value: <span title={item.createdAt}>{formatDate(item.createdAt)}</span> },
    {
      label: "Updated",
      value: (
        <span title={item.updatedAt}>
          {formatRelative(item.updatedAt)}
          {updatedBy && <span className="text-text-secondary"> by {updatedBy}</span>}
        </span>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Details</h4>
        <DescriptionList rows={rows} />
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <div>
          <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Description</h4>
          {item.description ? <p className="whitespace-pre-line text-[13px] leading-[1.5] text-text">{item.description}</p> : <p className="text-[13px] text-text-tertiary">No description yet.</p>}
        </div>
        <div>
          <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Last 12 weeks</h4>
          <MovementSparkline movements={movements} unit={item.unit} />
        </div>
      </div>
    </div>
  );
}
