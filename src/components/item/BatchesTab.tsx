"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Package } from "lucide-react";
import type { Item, Lot, Receipt } from "@/lib/types";
import { formatDate, formatMoney, formatNumber, formatQty, pluralize } from "@/lib/format";
import { daysBetween, round, sum } from "@/lib/utils";
import { Badge, EmptyState, Table, type Column } from "@/components/ui";
import { OLD_BATCH_DAYS, refHref } from "./utils";

export function BatchesTab({ item, lots, receipts, currency }: { item: Item; lots: Lot[]; receipts: Receipt[]; currency: string }) {
  const receiptById = useMemo(() => new Map(receipts.map((r) => [r.id, r])), [receipts]);

  const rows = useMemo(
    () =>
      lots
        .filter((l) => l.qtyRemaining > 0)
        .map((l) => ({ lot: l, age: daysBetween(l.receivedAt) }))
        .sort((a, b) => a.lot.receivedAt.localeCompare(b.lot.receivedAt)),
    [lots],
  );

  const summary = useMemo(() => {
    const totalQty = sum(rows.map((r) => r.lot.qtyRemaining));
    const avgAge = totalQty > 0 ? Math.round(sum(rows.map((r) => r.age * r.lot.qtyRemaining)) / totalQty) : 0;
    const oldest = rows[0];
    const value = round(sum(rows.map((r) => r.lot.qtyRemaining * r.lot.unitCost)));
    const old = rows.filter((r) => r.age > OLD_BATCH_DAYS).length;
    return { totalQty: round(totalQty, 3), avgAge, oldest, value, old };
  }, [rows]);

  type Row = (typeof rows)[number];

  const columns: Column<Row>[] = [
    { key: "received", header: "Received", sortValue: (r) => r.lot.receivedAt, render: (r) => <span title={r.lot.receivedAt}>{formatDate(r.lot.receivedAt)}</span> },
    {
      key: "age",
      header: "Age",
      align: "right",
      sortValue: (r) => r.age,
      render: (r) => (
        <span className="inline-flex items-center justify-end gap-1.5">
          <span>{pluralize(r.age, "day")}</span>
          {r.age > OLD_BATCH_DAYS && <Badge tone="warning">Old</Badge>}
        </span>
      ),
    },
    { key: "qtyReceived", header: "Received qty", align: "right", hideBelow: "sm", sortValue: (r) => r.lot.qtyReceived, render: (r) => formatQty(r.lot.qtyReceived, item.unit) },
    { key: "qtyRemaining", header: "Remaining", align: "right", sortValue: (r) => r.lot.qtyRemaining, render: (r) => <span className="font-medium">{formatQty(r.lot.qtyRemaining, item.unit)}</span> },
    { key: "unitCost", header: "Unit cost", align: "right", sortValue: (r) => r.lot.unitCost, render: (r) => formatMoney(r.lot.unitCost, currency) },
    { key: "value", header: "Value", align: "right", hideBelow: "md", sortValue: (r) => r.lot.qtyRemaining * r.lot.unitCost, render: (r) => formatMoney(round(r.lot.qtyRemaining * r.lot.unitCost), currency) },
    {
      key: "receipt",
      header: "Receipt",
      hideBelow: "sm",
      sortValue: (r) => (r.lot.receiptId ? receiptById.get(r.lot.receiptId)?.number : undefined) ?? "",
      render: (r) => {
        if (!r.lot.receiptId) return <span className="text-text-tertiary">{r.lot.expiresAt ? "" : "—"}</span>;
        const receipt = receiptById.get(r.lot.receiptId);
        const href = refHref("receipt", r.lot.receiptId);
        return href ? (
          <Link href={href} className="font-mono text-[12px] text-accent hover:underline">
            {receipt?.number ?? "Receipt"}
          </Link>
        ) : (
          <span>{receipt?.number ?? "—"}</span>
        );
      },
    },
  ];

  if (rows.length === 0) {
    return <EmptyState icon={<Package />} title="No batches on the shelf" description="Received and built stock is tracked in batches so you can see how long it has been sitting." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-text-secondary">
        <span>
          <span className="font-medium text-text tabular">{pluralize(rows.length, "batch", "batches")}</span> · {formatQty(summary.totalQty, item.unit)} remaining
        </span>
        <span>
          Weighted average age <span className="font-medium text-text tabular">{pluralize(summary.avgAge, "day")}</span>
        </span>
        {summary.oldest && (
          <span>
            Oldest <span className="font-medium text-text tabular">{pluralize(summary.oldest.age, "day")}</span> ({formatDate(summary.oldest.lot.receivedAt)})
          </span>
        )}
        <span>
          Batch value <span className="font-medium text-text tabular">{formatMoney(summary.value, currency)}</span>
        </span>
        {summary.old > 0 && <span className="text-warning">{formatNumber(summary.old)} older than {OLD_BATCH_DAYS} days</span>}
        {Math.abs(summary.totalQty - item.onHand) > 0.001 && <span className="text-text-tertiary">Batches cover {formatQty(summary.totalQty, item.unit)} of {formatQty(item.onHand, item.unit)} on hand</span>}
      </div>
      <Table rows={rows} columns={columns} rowKey={(r) => r.lot.id} defaultSort={{ key: "received", dir: "asc" }} dense pageSize={25} />
    </div>
  );
}
