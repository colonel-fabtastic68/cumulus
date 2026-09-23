"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ClipboardCheck, Eye, MoreHorizontal, PackageCheck, Send, XCircle } from "lucide-react";
import type { PurchaseOrder } from "@/lib/types";
import { poIsOpen, poIsOverdue, poOrderedUnits, poReceivedUnits, poTotal } from "@/lib/purchaseOrders";
import { useItemsById, useSettings } from "@/lib/store/provider";
import { formatDate, formatDateTime, formatMoney, formatRelative } from "@/lib/format";
import { matches } from "@/lib/utils";
import { Badge, Button, EmptyState, IconButton, Menu, SearchField, Segmented, Table, type Column } from "@/components/ui";
import { PoStatusBadge, type PoFilter } from "./poUtils";

interface Props {
  purchaseOrders: PurchaseOrder[];
  canWrite: boolean;
  busyId?: string | null;
  onSelect: (po: PurchaseOrder) => void;
  onSend: (po: PurchaseOrder) => void;
  onReceive: (po: PurchaseOrder) => void;
  onCancel: (po: PurchaseOrder) => void;
  onNew?: () => void;
}

const FILTERS: Array<{ value: PoFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "draft", label: "Drafts" },
  { value: "sent", label: "Sent" },
  { value: "partial", label: "Partly received" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All" },
];

export function PurchaseOrdersTable({ purchaseOrders, canWrite, busyId, onSelect, onSend, onReceive, onCancel, onNew }: Props) {
  const byId = useItemsById();
  const { currency } = useSettings();
  const [filter, setFilter] = useState<PoFilter>("open");
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const c: Record<PoFilter, number> = { open: 0, draft: 0, sent: 0, partial: 0, received: 0, cancelled: 0, all: purchaseOrders.length };
    for (const p of purchaseOrders) {
      c[p.status]++;
      if (poIsOpen(p)) c.open++;
    }
    return c;
  }, [purchaseOrders]);

  const rows = useMemo(() => {
    let list = filter === "all" ? purchaseOrders : filter === "open" ? purchaseOrders.filter(poIsOpen) : purchaseOrders.filter((p) => p.status === filter);
    if (q.trim()) list = list.filter((p) => matches(q, p.number, p.supplier, p.reference) || p.lines.some((l) => matches(q, byId.get(l.itemId)?.sku, l.supplierSku)));
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [purchaseOrders, filter, q, byId]);

  const columns = useMemo<Column<PurchaseOrder>[]>(
    () => [
      { key: "number", header: "Number", render: (p) => <span className="font-medium text-text">{p.number}</span>, sortValue: (p) => p.number, width: "110px" },
      { key: "supplier", header: "Supplier", render: (p) => <span className="block max-w-[240px] truncate">{p.supplier}</span>, sortValue: (p) => p.supplier },
      {
        key: "lines",
        header: "Lines",
        render: (p) => {
          const got = poReceivedUnits(p);
          const all = poOrderedUnits(p);
          return got > 0 && got < all ? (
            <span>
              {p.lines.length} · <span className="text-text-secondary">{got} of {all} units in</span>
            </span>
          ) : (
            p.lines.length
          );
        },
        sortValue: (p) => p.lines.length,
        align: "right",
        hideBelow: "sm",
      },
      { key: "total", header: "Total", render: (p) => formatMoney(poTotal(p), currency), sortValue: (p) => poTotal(p), align: "right" },
      {
        key: "expected",
        header: "Expected",
        render: (p) =>
          p.expectedAt ? (
            <span className="inline-flex items-center gap-1.5">
              {formatDate(p.expectedAt)}
              {poIsOverdue(p) && <Badge tone="warning">Overdue</Badge>}
            </span>
          ) : (
            <span className="text-text-tertiary">—</span>
          ),
        sortValue: (p) => p.expectedAt ?? null,
        hideBelow: "md",
      },
      { key: "created", header: "Created", render: (p) => <span className="text-text-secondary" title={formatDateTime(p.createdAt)}>{formatRelative(p.createdAt)}</span>, sortValue: (p) => p.createdAt, hideBelow: "lg" },
      { key: "status", header: "Status", render: (p) => <PoStatusBadge status={p.status} />, sortValue: (p) => p.status },
      {
        key: "actions",
        header: "",
        width: "44px",
        align: "right",
        render: (p) => (
          <div onClick={(e) => e.stopPropagation()} className="flex justify-end">
            <Menu
              trigger={
                <IconButton variant="plain" size="sm" aria-label={`Actions for ${p.number}`} className="text-text-secondary" loading={busyId === p.id}>
                  <MoreHorizontal className="h-4 w-4" />
                </IconButton>
              }
              items={[
                { label: "View details", icon: <Eye />, onSelect: () => onSelect(p) },
                ...(poIsOpen(p) && canWrite
                  ? ([
                      "divider",
                      ...(p.status === "draft" ? [{ label: "Mark as sent", icon: <Send />, onSelect: () => onSend(p), disabled: busyId === p.id }] : []),
                      { label: p.status === "partial" ? "Receive the rest" : "Receive", icon: <PackageCheck />, onSelect: () => onReceive(p), disabled: busyId === p.id },
                      { label: "Cancel order", icon: <XCircle />, destructive: true, onSelect: () => onCancel(p), disabled: busyId === p.id },
                    ] as const)
                  : []),
              ]}
            />
          </div>
        ),
      },
    ],
    [currency, canWrite, busyId, onSelect, onSend, onReceive, onCancel],
  );

  let empty: ReactNode;
  if (q.trim()) empty = <EmptyState icon={<ClipboardCheck />} title="No purchase orders match" description={`Nothing matches “${q.trim()}”. Try a PO number, supplier or SKU.`} action={<Button size="sm" onClick={() => setQ("")}>Clear search</Button>} />;
  else if (filter === "open" || filter === "all")
    empty = (
      <EmptyState
        icon={<ClipboardCheck />}
        title={purchaseOrders.length ? "No open purchase orders" : "No purchase orders yet"}
        description="Order from a supplier here, then receive the delivery against the order so stock, lots and costs land in one step. Strato can draft orders from everything below minimum."
        action={onNew ? <Button variant="primary" size="sm" onClick={onNew}>New purchase order</Button> : undefined}
      />
    );
  else empty = <EmptyState icon={<ClipboardCheck />} title={`No ${FILTERS.find((f) => f.value === filter)?.label.toLowerCase() ?? ""} orders`} description="Orders move through draft, sent, partly received and received." />;

  return (
    <Table
      rows={rows}
      columns={columns}
      rowKey={(p) => p.id}
      onRowClick={onSelect}
      defaultSort={{ key: "created", dir: "desc" }}
      pageSize={25}
      emptyState={empty}
      toolbar={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Segmented value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ ...f, count: counts[f.value] }))} />
          <SearchField value={q} onChange={setQ} placeholder="Search number, supplier or SKU" className="w-full sm:ml-auto sm:w-72" />
        </div>
      }
      footer={`${rows.length} ${rows.length === 1 ? "order" : "orders"}${rows.length ? ` · ${formatMoney(rows.reduce((t, p) => t + poTotal(p), 0), currency)}` : ""}`}
    />
  );
}
