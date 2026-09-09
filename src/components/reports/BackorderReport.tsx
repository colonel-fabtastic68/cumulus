"use client";

import { useMemo } from "react";
import Link from "next/link";
import { FileDown } from "lucide-react";
import { backorderReport, type BackorderRow } from "@/lib/inventory";
import { useCollection, useItems } from "@/lib/store/provider";
import { formatDate, formatNumber, formatRelative } from "@/lib/format";
import { Badge, Button, EmptyState, Table, type Column } from "@/components/ui";
import { downloadCsv } from "./csv";

/** Factor 34: every open order line that stock cannot cover, with when it could ship. */
export function BackorderReport() {
  const items = useItems();
  const orders = useCollection("orders");
  const suppliers = useCollection("suppliers");
  const rows = useMemo(() => backorderReport(orders, items, suppliers), [orders, items, suppliers]);

  const columns = useMemo<Column<BackorderRow>[]>(
    () => [
      {
        key: "order",
        header: "Order",
        render: (r) => (
          <Link href={`/orders?highlight=${r.order.id}`} className="font-mono text-[12px] text-accent hover:underline">
            {r.order.number}
          </Link>
        ),
        sortValue: (r) => r.order.number,
      },
      { key: "customer", header: "Customer", render: (r) => r.order.customer, sortValue: (r) => r.order.customer, hideBelow: "md" },
      {
        key: "sku",
        header: "Item",
        render: (r) =>
          r.item ? (
            <Link href={`/inventory/${r.item.id}`} className="font-mono text-[12px] text-accent hover:underline">
              {r.item.sku}
            </Link>
          ) : (
            <span className="text-text-tertiary">{r.line.itemId}</span>
          ),
        sortValue: (r) => r.item?.sku ?? "",
      },
      { key: "open", header: "Open", align: "right", render: (r) => <span className="tabular">{formatNumber(r.openQty)}</span>, sortValue: (r) => r.openQty },
      { key: "available", header: "On hand", align: "right", render: (r) => <span className="tabular">{formatNumber(r.available)}</span>, sortValue: (r) => r.available },
      { key: "short", header: "Short by", align: "right", render: (r) => <span className="font-medium text-warning tabular">{formatNumber(r.shortBy)}</span>, sortValue: (r) => r.shortBy },
      { key: "supplier", header: "Supplier", render: (r) => r.supplier?.name ?? <span className="text-text-tertiary">—</span>, sortValue: (r) => r.supplier?.name ?? "", hideBelow: "lg" },
      {
        key: "expected",
        header: "Could ship",
        render: (r) => (r.expectedAt ? <span title={formatDate(r.expectedAt)}>{formatRelative(r.expectedAt)}</span> : <Badge>No lead time</Badge>),
        sortValue: (r) => r.expectedAt ?? "9999",
        hideBelow: "md",
      },
      { key: "age", header: "Ordered", render: (r) => <span className="text-text-secondary">{formatRelative(r.order.createdAt)}</span>, sortValue: (r) => r.order.createdAt, hideBelow: "lg" },
    ],
    [],
  );

  const exportCsv = () => {
    downloadCsv(
      "backorders.csv",
      ["Order", "Customer", "SKU", "Open", "On hand", "Short by", "Supplier", "Could ship", "Ordered"],
      rows.map((r) => [r.order.number, r.order.customer, r.item?.sku ?? r.line.itemId, r.openQty, r.available, r.shortBy, r.supplier?.name ?? "", r.expectedAt ? formatDate(r.expectedAt) : "", formatDate(r.order.createdAt)]),
    );
  };

  if (rows.length === 0) {
    return (
      <div className="card">
        <EmptyState title="No backorders" description="Every open order line can ship from what is on hand. Lines that come up short appear here with the earliest date the shortfall could land." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button icon={<FileDown />} onClick={exportCsv}>
          Export CSV
        </Button>
      </div>
      <Table rows={rows} columns={columns} rowKey={(r) => `${r.order.id}-${r.line.itemId}`} dense pageSize={50} defaultSort={{ key: "age", dir: "asc" }} footer={`${rows.length} backordered line${rows.length === 1 ? "" : "s"} across ${new Set(rows.map((r) => r.order.id)).size} order${new Set(rows.map((r) => r.order.id)).size === 1 ? "" : "s"}`} />
      <p className="text-[12px] text-text-tertiary">Expected dates come from the item&apos;s lead time, or its supplier&apos;s, counted from today. Receiving a delivery that covers a line posts a note in Activity.</p>
    </div>
  );
}
