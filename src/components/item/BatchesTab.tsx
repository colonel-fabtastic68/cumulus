"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Package, ScanSearch } from "lucide-react";
import type { Item, Lot, Receipt } from "@/lib/types";
import { useCollection } from "@/lib/store/provider";
import { lotLabel, lotSourceLabel } from "@/lib/traceability";
import { formatDate, formatMoney, formatNumber, formatQty, pluralize } from "@/lib/format";
import { daysBetween, round, sum } from "@/lib/utils";
import { Badge, EmptyState, Segmented, Table, type Column } from "@/components/ui";
import { OLD_BATCH_DAYS, refHref } from "./utils";

type View = "shelf" | "all";

export function BatchesTab({ item, lots, receipts, currency }: { item: Item; lots: Lot[]; receipts: Receipt[]; currency: string }) {
  const builds = useCollection("builds");
  const purchaseOrders = useCollection("purchaseOrders");
  const receiptById = useMemo(() => new Map(receipts.map((r) => [r.id, r])), [receipts]);
  const buildById = useMemo(() => new Map(builds.map((b) => [b.id, b])), [builds]);
  const poById = useMemo(() => new Map(purchaseOrders.map((p) => [p.id, p])), [purchaseOrders]);
  const [view, setView] = useState<View>("shelf");

  const rows = useMemo(
    () =>
      lots
        .filter((l) => view === "all" || l.qtyRemaining > 0)
        .map((l) => ({ lot: l, age: daysBetween(l.receivedAt), expired: !!l.expiresAt && l.expiresAt < new Date().toISOString() }))
        .sort((a, b) => a.lot.receivedAt.localeCompare(b.lot.receivedAt)),
    [lots, view],
  );
  const onShelf = useMemo(() => rows.filter((r) => r.lot.qtyRemaining > 0), [rows]);

  const summary = useMemo(() => {
    const totalQty = sum(onShelf.map((r) => r.lot.qtyRemaining));
    const avgAge = totalQty > 0 ? Math.round(sum(onShelf.map((r) => r.age * r.lot.qtyRemaining)) / totalQty) : 0;
    const oldest = onShelf[0];
    const value = round(sum(onShelf.map((r) => r.lot.qtyRemaining * r.lot.unitCost)));
    const old = onShelf.filter((r) => r.age > OLD_BATCH_DAYS).length;
    const expired = onShelf.filter((r) => r.expired).length;
    return { totalQty: round(totalQty, 3), avgAge, oldest, value, old, expired };
  }, [onShelf]);

  type Row = (typeof rows)[number];

  const columns: Column<Row>[] = [
    {
      key: "lot",
      header: "Batch",
      sortValue: (r) => lotLabel(r.lot),
      render: (r) => (
        <span className="block min-w-0">
          <Link href={`/reports?tab=traceability&lot=${encodeURIComponent(r.lot.id)}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[12px] text-accent hover:underline" title="Trace this batch">
            {lotLabel(r.lot)}
          </Link>
          {r.lot.supplierLot && r.lot.number && <span className="block truncate text-[11.5px] text-text-tertiary">Supplier lot {r.lot.supplierLot}</span>}
        </span>
      ),
    },
    { key: "received", header: "Received", sortValue: (r) => r.lot.receivedAt, render: (r) => <span title={r.lot.receivedAt}>{formatDate(r.lot.receivedAt)}</span> },
    {
      key: "source",
      header: "From",
      hideBelow: "sm",
      sortValue: (r) => lotSourceLabel(r.lot),
      render: (r) => {
        const receipt = r.lot.receiptId ? receiptById.get(r.lot.receiptId) : undefined;
        const build = r.lot.buildId ? buildById.get(r.lot.buildId) : undefined;
        const po = r.lot.purchaseOrderId ? poById.get(r.lot.purchaseOrderId) : undefined;
        const href = receipt ? refHref("receipt", receipt.id) : build ? refHref("build", build.id) : null;
        const number = receipt?.number ?? build?.number;
        return (
          <span className="block min-w-0 text-[12.5px]">
            <span className="text-text-secondary">{lotSourceLabel(r.lot)}</span>
            {number && href && (
              <>
                {" "}
                <Link href={href} onClick={(e) => e.stopPropagation()} className="font-mono text-[12px] text-accent hover:underline">
                  {number}
                </Link>
              </>
            )}
            {po && (
              <span className="block truncate text-[11.5px] text-text-tertiary">
                on{" "}
                <Link href={`/orders/purchase?highlight=${po.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-accent hover:underline">
                  {po.number}
                </Link>
                {po.supplier ? ` · ${po.supplier}` : ""}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "age",
      header: "Age",
      align: "right",
      sortValue: (r) => r.age,
      render: (r) => (
        <span className="inline-flex items-center justify-end gap-1.5">
          <span>{pluralize(r.age, "day")}</span>
          {r.lot.qtyRemaining > 0 && r.age > OLD_BATCH_DAYS && <Badge tone="warning">Old</Badge>}
        </span>
      ),
    },
    {
      key: "expires",
      header: "Expires",
      hideBelow: "md",
      sortValue: (r) => r.lot.expiresAt ?? "",
      render: (r) => (r.lot.expiresAt ? <span className={r.expired ? "font-medium text-critical" : r.lot.qtyRemaining > 0 && daysBetween(new Date().toISOString(), r.lot.expiresAt) < 30 ? "text-warning" : undefined}>{formatDate(r.lot.expiresAt)}</span> : <span className="text-text-tertiary">—</span>),
    },
    { key: "qtyReceived", header: "Received qty", align: "right", hideBelow: "sm", sortValue: (r) => r.lot.qtyReceived, render: (r) => formatQty(r.lot.qtyReceived, item.unit) },
    { key: "qtyRemaining", header: "Remaining", align: "right", sortValue: (r) => r.lot.qtyRemaining, render: (r) => <span className={r.lot.qtyRemaining > 0 ? "font-medium" : "text-text-tertiary"}>{formatQty(r.lot.qtyRemaining, item.unit)}</span> },
    { key: "unitCost", header: "Unit cost", align: "right", sortValue: (r) => r.lot.unitCost, render: (r) => formatMoney(r.lot.unitCost, currency) },
    { key: "value", header: "Value", align: "right", hideBelow: "md", sortValue: (r) => r.lot.qtyRemaining * r.lot.unitCost, render: (r) => formatMoney(round(r.lot.qtyRemaining * r.lot.unitCost), currency) },
  ];

  if (lots.length === 0) {
    return <EmptyState icon={<Package />} title="No batches yet" description="Received and built stock is tracked in numbered batches, so every unit can be traced back to its delivery or build and forward to where it went." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px] text-text-secondary">
        <span>
          <span className="font-medium text-text tabular">{pluralize(onShelf.length, "batch", "batches")}</span> on the shelf · {formatQty(summary.totalQty, item.unit)} remaining
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
        {summary.expired > 0 && <span className="text-critical">{formatNumber(summary.expired)} expired</span>}
        {Math.abs(summary.totalQty - item.onHand) > 0.001 && <span className="text-text-tertiary">Batches cover {formatQty(summary.totalQty, item.unit)} of {formatQty(item.onHand, item.unit)} on hand</span>}
      </div>
      <Table
        rows={rows}
        columns={columns}
        rowKey={(r) => r.lot.id}
        defaultSort={{ key: "received", dir: "asc" }}
        dense
        pageSize={25}
        toolbar={
          <div className="flex w-full flex-wrap items-center gap-2">
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "shelf", label: "On the shelf", count: lots.filter((l) => l.qtyRemaining > 0).length },
                { value: "all", label: "All batches", count: lots.length },
              ]}
            />
            <Link href={`/reports?tab=traceability&q=${encodeURIComponent(item.sku)}`} className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] text-accent hover:underline">
              <ScanSearch className="h-3.5 w-3.5" />
              Trace {item.sku}
            </Link>
          </div>
        }
        emptyState={<span>Nothing on the shelf from a batch. Switch to All batches to see used-up ones.</span>}
      />
    </div>
  );
}
