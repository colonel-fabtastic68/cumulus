"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Eye, MoreHorizontal, PackageCheck, ShoppingCart, Truck, XCircle } from "lucide-react";
import type { Item, SalesOrder } from "@/lib/types";
import { isOrderOpen, orderIsBackordered } from "@/lib/inventory";
import { useItemsById, useSettings } from "@/lib/store/provider";
import { formatDate, formatDateTime, formatMoney, formatRelative } from "@/lib/format";
import { matches } from "@/lib/utils";
import { Badge, Button, EmptyState, IconButton, Menu, SearchField, Segmented, StatusBadge, Table, type Column } from "@/components/ui";
import { describeShortages, orderAvailability, orderOpenUnits, orderShippedUnits, orderTotal, orderUnits, SourceBadge, type OrderFilter } from "./orderUtils";

interface OrdersTableProps {
  orders: SalesOrder[];
  canWrite: boolean;
  busyId?: string | null;
  onSelect: (order: SalesOrder) => void;
  onFulfil: (order: SalesOrder) => void;
  onCancel: (order: SalesOrder) => void;
  onNew?: () => void;
}

const FILTERS: Array<{ value: OrderFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "partial", label: "Partly shipped" },
  { value: "backordered", label: "Backordered" },
  { value: "fulfilled", label: "Fulfilled" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All" },
];

function AvailabilityCell({ order, byId }: { order: SalesOrder; byId: Map<string, Item> }) {
  if (!isOrderOpen(order)) return <span className="text-text-tertiary">—</span>;
  const a = orderAvailability(order, byId);
  if (a.ready) return <Badge tone="success">Ready</Badge>;
  return (
    <span title={describeShortages(a.short)}>
      <Badge tone="warning">Backordered</Badge>
    </span>
  );
}

export function OrdersTable({ orders, canWrite, busyId, onSelect, onFulfil, onCancel, onNew }: OrdersTableProps) {
  const byId = useItemsById();
  const { currency } = useSettings();
  const [filter, setFilter] = useState<OrderFilter>("open");
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const c = { open: 0, partial: 0, backordered: 0, fulfilled: 0, cancelled: 0, all: orders.length };
    for (const o of orders) {
      c[o.status]++;
      if (orderIsBackordered(o, byId)) c.backordered++;
    }
    return c;
  }, [orders, byId]);

  const rows = useMemo(() => {
    let list = filter === "all" ? orders : filter === "backordered" ? orders.filter((o) => orderIsBackordered(o, byId)) : orders.filter((o) => o.status === filter);
    if (q.trim()) {
      list = list.filter((o) => matches(q, o.number, o.customer) || o.lines.some((l) => matches(q, byId.get(l.itemId)?.sku)));
    }
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [orders, filter, q, byId]);

  const columns = useMemo<Column<SalesOrder>[]>(
    () => [
      {
        key: "number",
        header: "Number",
        render: (o) => <span className="font-medium text-text">{o.number}</span>,
        sortValue: (o) => o.number,
        width: "110px",
      },
      {
        key: "customer",
        header: "Customer",
        render: (o) => <span className="block max-w-[240px] truncate">{o.customer}</span>,
        sortValue: (o) => o.customer,
      },
      {
        key: "source",
        header: "Source",
        render: (o) => <SourceBadge source={o.source} />,
        sortValue: (o) => o.source,
        hideBelow: "md",
      },
      {
        key: "lines",
        header: "Lines",
        render: (o) => (o.status === "partial" ? <span title={`${orderShippedUnits(o)} of ${orderUnits(o)} units shipped`}>{o.lines.length} · <span className="text-text-secondary">{orderOpenUnits(o)} open</span></span> : o.lines.length),
        sortValue: (o) => o.lines.length,
        align: "right",
        hideBelow: "sm",
      },
      {
        key: "total",
        header: "Total",
        render: (o) => formatMoney(orderTotal(o), currency),
        sortValue: (o) => orderTotal(o),
        align: "right",
      },
      {
        key: "availability",
        header: "Availability",
        render: (o) => <AvailabilityCell order={o} byId={byId} />,
        sortValue: (o) => (!isOrderOpen(o) ? null : orderAvailability(o, byId).ready ? 1 : 0),
        hideBelow: "md",
      },
      {
        key: "created",
        header: "Created",
        render: (o) => (
          <span className="text-text-secondary" title={formatDateTime(o.createdAt)}>
            {formatRelative(o.createdAt)}
          </span>
        ),
        sortValue: (o) => o.createdAt,
        hideBelow: "lg",
      },
      {
        key: "fulfilled",
        header: "Fulfilled",
        render: (o) => <span className="text-text-secondary">{o.fulfilledAt ? formatDate(o.fulfilledAt) : "—"}</span>,
        sortValue: (o) => o.fulfilledAt ?? null,
        hideBelow: "lg",
      },
      {
        key: "status",
        header: "Status",
        render: (o) => <StatusBadge status={o.status} />,
        sortValue: (o) => o.status,
      },
      {
        key: "actions",
        header: "",
        width: "44px",
        align: "right",
        render: (o) => {
          const open = isOrderOpen(o);
          return (
            <div onClick={(e) => e.stopPropagation()} className="flex justify-end">
              <Menu
                trigger={
                  <IconButton variant="plain" size="sm" aria-label={`Actions for ${o.number}`} className="text-text-secondary" loading={busyId === o.id}>
                    <MoreHorizontal className="h-4 w-4" />
                  </IconButton>
                }
                items={[
                  { label: "View details", icon: <Eye />, onSelect: () => onSelect(o) },
                  ...(open && canWrite
                    ? ([
                        "divider",
                        { label: o.status === "partial" ? "Ship the rest" : "Ship", icon: <Truck />, onSelect: () => onFulfil(o), disabled: busyId === o.id },
                        { label: "Cancel order", icon: <XCircle />, destructive: true, onSelect: () => onCancel(o), disabled: busyId === o.id },
                      ] as const)
                    : []),
                ]}
              />
            </div>
          );
        },
      },
    ],
    [byId, currency, canWrite, busyId, onSelect, onFulfil, onCancel],
  );

  let empty: ReactNode;
  if (q.trim()) {
    empty = <EmptyState icon={<ShoppingCart />} title="No orders match" description={`Nothing matches “${q.trim()}”. Try an order number, customer or SKU.`} action={<Button size="sm" onClick={() => setQ("")}>Clear search</Button>} />;
  } else if (filter === "open") {
    empty = (
      <EmptyState
        icon={<ShoppingCart />}
        title="No open orders"
        description={orders.length ? "Everything has shipped. New orders will show up here until they are fulfilled." : "Orders relieve stock when they ship. Create your first order to get started."}
        action={onNew ? <Button variant="primary" size="sm" onClick={onNew}>New order</Button> : undefined}
      />
    );
  } else if (filter === "partial") {
    empty = <EmptyState icon={<Truck />} title="No partly shipped orders" description="Orders shipped in part stay here until the last line goes out." />;
  } else if (filter === "backordered") {
    empty = <EmptyState icon={<PackageCheck />} title="Nothing on backorder" description="Every open line can ship from what is on the shelf. Short lines show up here, and on the Backorders report with expected dates." />;
  } else if (filter === "fulfilled") {
    empty = <EmptyState icon={<PackageCheck />} title="Nothing shipped yet" description="Fulfilled orders appear here with the date they shipped." />;
  } else if (filter === "cancelled") {
    empty = <EmptyState icon={<XCircle />} title="No cancelled orders" description="Cancelled orders keep their number but never move stock." />;
  } else {
    empty = (
      <EmptyState
        icon={<ShoppingCart />}
        title="No orders yet"
        description="Sales orders relieve stock when they ship. Create one by hand or connect a store to import them."
        action={onNew ? <Button variant="primary" size="sm" onClick={onNew}>New order</Button> : undefined}
      />
    );
  }

  return (
    <Table
      rows={rows}
      columns={columns}
      rowKey={(o) => o.id}
      onRowClick={onSelect}
      defaultSort={{ key: "created", dir: "desc" }}
      pageSize={25}
      emptyState={empty}
      toolbar={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Segmented value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ ...f, count: counts[f.value] }))} />
          <SearchField value={q} onChange={setQ} placeholder="Search number, customer or SKU" className="w-full sm:ml-auto sm:w-72" />
        </div>
      }
      footer={`${rows.length} ${rows.length === 1 ? "order" : "orders"}${rows.length ? ` · ${formatMoney(rows.reduce((t, o) => t + orderTotal(o), 0), currency)}` : ""}`}
    />
  );
}
