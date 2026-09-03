"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PackageCheck, ShoppingCart } from "lucide-react";
import type { Item, SalesOrder } from "@/lib/types";
import { fulfillOrder } from "@/lib/inventory";
import { useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { formatRelative, pluralize } from "@/lib/format";
import { Badge, Button, Card, ConfirmDialog, Table, useToast, type Column } from "@/components/ui";
import { orderIsShort, orderUnits } from "./dashboardData";
import { CardLink, CardTitle } from "./CardTitle";

const MAX_ROWS = 6;

export function ToShipCard({ orders, itemsById }: { orders: SalesOrder[]; itemsById: Map<string, Item> }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const writable = canWrite(user);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<SalesOrder | null>(null);

  const visible = useMemo(() => orders.slice(0, MAX_ROWS), [orders]);

  const fulfil = async (o: SalesOrder) => {
    setConfirmTarget(null);
    setBusyId(o.id);
    try {
      await fulfillOrder(store, user, o.id);
      toast(`Shipped ${o.number} to ${o.customer}`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusyId(null);
    }
  };

  const columns = useMemo<Column<SalesOrder>[]>(
    () => [
      {
        key: "number",
        header: "Order",
        width: "110px",
        render: (o) => (
          <Link href={"/orders?highlight=" + o.id} className="font-mono text-[12px] font-medium text-accent hover:underline">
            {o.number}
          </Link>
        ),
      },
      {
        key: "customer",
        header: "Customer",
        render: (o) => (
          <span className="flex items-center gap-2">
            <span className="block max-w-[220px] truncate text-text" title={o.customer}>
              {o.customer}
            </span>
            {o.source !== "manual" && <Badge>{o.source}</Badge>}
          </span>
        ),
      },
      {
        key: "lines",
        header: "Lines",
        render: (o) => {
          const short = orderIsShort(o, itemsById);
          const summary = o.lines.map((l) => `${itemsById.get(l.itemId)?.sku ?? "?"} ×${l.qty}`).join(" · ");
          return (
            <span className="block min-w-0">
              <span className="flex items-center gap-2 text-text">
                {pluralize(o.lines.length, "line")}
                <span className="text-text-tertiary">· {pluralize(orderUnits(o), "unit")}</span>
                {short && <Badge tone="warning">Short stock</Badge>}
              </span>
              <span className="block max-w-[320px] truncate font-mono text-[11.5px] text-text-tertiary" title={summary}>
                {summary}
              </span>
            </span>
          );
        },
      },
      {
        key: "created",
        header: "Created",
        hideBelow: "sm",
        align: "right",
        render: (o) => (
          <span className="text-text-secondary" title={o.createdAt}>
            {formatRelative(o.createdAt)}
          </span>
        ),
      },
      {
        key: "actions",
        header: "",
        align: "right",
        width: "90px",
        render: (o) =>
          writable ? (
            <Button size="sm" icon={<PackageCheck />} loading={busyId === o.id} disabled={busyId !== null && busyId !== o.id} onClick={() => setConfirmTarget(o)}>
              Fulfil
            </Button>
          ) : null,
      },
    ],
    [itemsById, writable, busyId],
  );

  if (orders.length === 0) {
    return (
      <Card>
        <CardTitle icon={<ShoppingCart />} title="To ship" action={<CardLink href="/orders">All orders</CardLink>} />
        <p className="mt-3 text-[13px] text-text-secondary">Nothing waiting to ship. New open orders will show up here.</p>
      </Card>
    );
  }

  return (
    <>
    <ConfirmDialog
      open={!!confirmTarget}
      onClose={() => setConfirmTarget(null)}
      onConfirm={() => confirmTarget && void fulfil(confirmTarget)}
      title={confirmTarget ? `Ship ${confirmTarget.number}?` : "Ship order?"}
      confirmLabel="Ship it"
      message={
        confirmTarget ? (
          <span>
            {confirmTarget.lines.map((l) => `${l.qty} × ${itemsById.get(l.itemId)?.sku ?? "?"}`).join(", ")} will leave stock for {confirmTarget.customer}. Shipping cannot be undone; a return needs an RMA.
          </span>
        ) : null
      }
    />
    <Table
      rows={visible}
      columns={columns}
      rowKey={(o) => o.id}
      dense
      stickyHeader={false}
      toolbar={
        <CardTitle
          icon={<ShoppingCart />}
          title="To ship"
          meta={<Badge tone="info">{orders.length} open</Badge>}
          action={<CardLink href="/orders">All orders</CardLink>}
        />
      }
      footer={
        <span>
          {orders.length > visible.length ? (
            <Link href="/orders" className="font-medium text-accent hover:underline">
              View all {orders.length} open orders
            </Link>
          ) : (
            `${pluralize(orders.length, "open order")}`
          )}
        </span>
      }
    />
    </>
  );
}
