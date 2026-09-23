"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, FileDown } from "lucide-react";
import type { Item, PurchaseOrder, PurchaseOrderLine } from "@/lib/types";
import { poIsOpen, poIsOverdue, poLineOpenQty } from "@/lib/purchaseOrders";
import { useCollection, useItemsById, useSettings } from "@/lib/store/provider";
import { formatDate, formatMoney, formatNumber, formatRelative, pluralize } from "@/lib/format";
import { round, sum } from "@/lib/utils";
import { Badge, Button, EmptyState, Segmented, Table, type Column } from "@/components/ui";
import { PoStatusBadge } from "@/components/purchasing/poUtils";
import { downloadCsv } from "./csv";
import { AskAgentButton } from "./shared";

interface Row {
  po: PurchaseOrder;
  line: PurchaseOrderLine;
  item?: Item;
  open: number;
  openValue: number;
  overdue: boolean;
}

type View = "all" | "sent" | "draft" | "overdue";

const VIEWS: Array<{ value: View; label: string }> = [
  { value: "all", label: "All open" },
  { value: "sent", label: "Sent" },
  { value: "draft", label: "Drafts" },
  { value: "overdue", label: "Overdue" },
];

/** Every line still due on an open purchase order, with what has arrived and what it is worth. */
export function PurchaseOrdersReport() {
  const purchaseOrders = useCollection("purchaseOrders");
  const itemsById = useItemsById();
  const { currency } = useSettings();
  const [view, setView] = useState<View>("all");

  const allRows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const po of purchaseOrders) {
      if (!poIsOpen(po)) continue;
      const overdue = poIsOverdue(po);
      for (const line of po.lines) {
        const open = poLineOpenQty(line);
        if (open <= 0) continue;
        out.push({ po, line, item: itemsById.get(line.itemId), open, openValue: round(open * line.unitCost), overdue });
      }
    }
    return out;
  }, [purchaseOrders, itemsById]);

  const counts = useMemo<Record<View, number>>(
    () => ({ all: allRows.length, sent: allRows.filter((r) => r.po.status === "sent" || r.po.status === "partial").length, draft: allRows.filter((r) => r.po.status === "draft").length, overdue: allRows.filter((r) => r.overdue).length }),
    [allRows],
  );
  const rows = useMemo(() => (view === "all" ? allRows : view === "overdue" ? allRows.filter((r) => r.overdue) : view === "draft" ? allRows.filter((r) => r.po.status === "draft") : allRows.filter((r) => r.po.status === "sent" || r.po.status === "partial")), [allRows, view]);
  const orderCount = new Set(rows.map((r) => r.po.id)).size;
  const openValue = sum(rows.map((r) => r.openValue));

  const columns = useMemo<Column<Row>[]>(
    () => [
      {
        key: "po",
        header: "PO",
        render: (r) => (
          <Link href={`/orders/purchase?highlight=${r.po.id}`} className="font-mono text-[12px] text-accent hover:underline">
            {r.po.number}
          </Link>
        ),
        sortValue: (r) => r.po.number,
      },
      { key: "status", header: "Status", render: (r) => <PoStatusBadge status={r.po.status} />, sortValue: (r) => r.po.status, hideBelow: "md" },
      { key: "supplier", header: "Supplier", render: (r) => <span className="block max-w-[200px] truncate">{r.po.supplier}</span>, sortValue: (r) => r.po.supplier },
      {
        key: "sku",
        header: "Item",
        render: (r) =>
          r.item ? (
            <span className="block min-w-0">
              <Link href={`/inventory/${r.item.id}`} className="font-mono text-[12px] text-accent hover:underline">
                {r.item.sku}
              </Link>
              <span className="block max-w-[240px] truncate text-[12px] text-text-secondary">{r.item.name}</span>
            </span>
          ) : (
            <span className="text-text-tertiary">{r.line.itemId}</span>
          ),
        sortValue: (r) => r.item?.sku ?? "",
      },
      { key: "supplierSku", header: "Supplier SKU", render: (r) => (r.line.supplierSku ? <span className="font-mono text-[12px] text-text-secondary">{r.line.supplierSku}</span> : <span className="text-text-tertiary">—</span>), sortValue: (r) => r.line.supplierSku ?? "", hideBelow: "lg" },
      { key: "ordered", header: "Ordered", align: "right", render: (r) => <span className="tabular">{formatNumber(r.line.qty)}</span>, sortValue: (r) => r.line.qty, hideBelow: "md" },
      { key: "received", header: "Received", align: "right", render: (r) => <span className="tabular text-text-secondary">{formatNumber(r.line.received ?? 0)}</span>, sortValue: (r) => r.line.received ?? 0, hideBelow: "md" },
      { key: "open", header: "Open", align: "right", render: (r) => <span className="font-medium tabular">{formatNumber(r.open)}</span>, sortValue: (r) => r.open },
      { key: "unitCost", header: "Unit cost", align: "right", render: (r) => <span className="tabular">{formatMoney(r.line.unitCost, currency)}</span>, sortValue: (r) => r.line.unitCost, hideBelow: "lg" },
      { key: "openValue", header: "Open value", align: "right", render: (r) => <span className="tabular">{formatMoney(r.openValue, currency)}</span>, sortValue: (r) => r.openValue },
      {
        key: "expected",
        header: "Expected",
        render: (r) =>
          r.po.expectedAt ? (
            <span className="inline-flex items-center gap-1.5" title={formatDate(r.po.expectedAt)}>
              {formatRelative(r.po.expectedAt)}
              {r.overdue && <Badge tone="warning">Overdue</Badge>}
            </span>
          ) : (
            <Badge>No date</Badge>
          ),
        sortValue: (r) => r.po.expectedAt ?? "9999",
        hideBelow: "md",
      },
      { key: "created", header: "Ordered", render: (r) => <span className="text-text-secondary">{formatRelative(r.po.sentAt ?? r.po.createdAt)}</span>, sortValue: (r) => r.po.sentAt ?? r.po.createdAt, hideBelow: "lg" },
    ],
    [currency],
  );

  const exportCsv = () => {
    downloadCsv(
      "open-purchase-orders.csv",
      ["PO", "Status", "Supplier", "SKU", "Item", "Supplier SKU", "Ordered", "Received", "Open", "Unit cost", "Open value", "Expected", "Ordered on"],
      rows.map((r) => [r.po.number, r.po.status, r.po.supplier, r.item?.sku ?? r.line.itemId, r.item?.name ?? "", r.line.supplierSku ?? "", r.line.qty, r.line.received ?? 0, r.open, r.line.unitCost, r.openValue, r.po.expectedAt ?? "", formatDate(r.po.sentAt ?? r.po.createdAt)]),
    );
  };

  if (allRows.length === 0) {
    return (
      <div className="card">
        <EmptyState icon={<ClipboardCheck />} title="Nothing on order" description="Lines still due on draft, sent and partly received purchase orders appear here, with what has arrived and what is still to come." action={<Button size="sm" href="/orders/purchase">Purchase orders</Button>} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented value={view} onChange={setView} options={VIEWS.map((v) => ({ ...v, count: counts[v.value] }))} />
        <div className="ml-auto flex items-center gap-2">
          <AskAgentButton prompt="Which open purchase orders are late or due this week, and what should I chase with each supplier?" />
          <Button size="sm" icon={<FileDown />} onClick={exportCsv} disabled={rows.length === 0}>
            Export CSV
          </Button>
        </div>
      </div>
      <Table
        rows={rows}
        columns={columns}
        rowKey={(r) => `${r.po.id}-${r.line.itemId}`}
        dense
        pageSize={50}
        defaultSort={{ key: "expected", dir: "asc" }}
        emptyState={<EmptyState icon={<ClipboardCheck />} title={view === "overdue" ? "Nothing overdue" : view === "draft" ? "No draft orders" : "No sent orders"} description="Switch to All open to see every line still due." />}
        footer={`${pluralize(rows.length, "line")} across ${pluralize(orderCount, "order")} · ${formatMoney(openValue, currency)} still to arrive`}
      />
      <p className="text-[12px] text-text-tertiary">Open is ordered minus received. Receive a delivery from the order itself so these lines close and the receipt carries the PO number.</p>
    </div>
  );
}
