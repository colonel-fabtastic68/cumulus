"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import type { SalesOrder } from "@/lib/types";
import { cancelOrder, fulfillOrder } from "@/lib/inventory";
import { useCollection, useItemsById, useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { Button, ConfirmDialog, Page, QueryParamEffect, useToast } from "@/components/ui";
import { NewOrderModal, OrderDetailModal, OrderStats, OrdersTable } from "@/components/orders";

export default function OrdersPage() {
  const orders = useCollection("orders");
  const itemsById = useItemsById();
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const writable = canWrite(user);
  const { setPageContext } = useAgent();

  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SalesOrder | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const selected = useMemo(() => (selectedId ? (orders.find((o) => o.id === selectedId) ?? null) : null), [orders, selectedId]);

  const selectedSkus = useMemo(() => {
    if (!selected) return undefined;
    return selected.lines.map((l) => itemsById.get(l.itemId)?.sku).filter((s): s is string => !!s);
  }, [selected, itemsById]);

  useEffect(() => {
    setPageContext({ page: "Orders", selectedSkus });
  }, [setPageContext, selectedSkus]);


  const fulfil = useCallback(
    async (order: SalesOrder) => {
      if (!writable) return;
      setBusyId(order.id);
      try {
        const shipped = await fulfillOrder(store, user, order.id);
        toast(`Shipped ${shipped.number} to ${shipped.customer}`, "success");
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), "critical");
      } finally {
        setBusyId(null);
      }
    },
    [store, user, toast, writable],
  );

  const requestCancel = useCallback(
    (order: SalesOrder) => {
      if (!writable) return;
      setCancelTarget(order);
    },
    [writable],
  );

  const confirmCancel = async () => {
    const order = cancelTarget;
    if (!order) return;
    setBusyId(order.id);
    try {
      await cancelOrder(store, user, order.id);
      toast(`Cancelled ${order.number}`, "success");
      setCancelTarget(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusyId(null);
    }
  };

  const newOrderButton = writable ? (
    <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
      New order
    </Button>
  ) : undefined;

  return (
    <Page title="Orders" subtitle="Sales orders relieve stock when shipped" primaryAction={newOrderButton}>
      {/* "?highlight=<orderId>" opens that order, also when navigating here while already on the page. */}
      <Suspense fallback={null}>
        <QueryParamEffect param="highlight" onValue={setSelectedId} />
      </Suspense>
      <div className="flex flex-col gap-4">
        <OrderStats orders={orders} />
        <OrdersTable orders={orders} canWrite={writable} busyId={busyId} onSelect={(o) => setSelectedId(o.id)} onFulfil={fulfil} onCancel={requestCancel} onNew={writable ? () => setCreating(true) : undefined} />
      </div>

      <NewOrderModal open={creating} onClose={() => setCreating(false)} onCreated={(order) => setSelectedId(order.id)} />

      <OrderDetailModal order={selected} onClose={() => setSelectedId(null)} canWrite={writable} busy={!!selected && busyId === selected.id} onFulfil={fulfil} onCancel={requestCancel} />

      <ConfirmDialog
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
        title={cancelTarget ? `Cancel ${cancelTarget.number}?` : "Cancel order?"}
        message={
          cancelTarget ? (
            <p>
              The order for <span className="font-medium text-text">{cancelTarget.customer}</span> will be marked cancelled. Stock is not affected and the order keeps its number. This can&apos;t be undone.
            </p>
          ) : null
        }
        confirmLabel="Cancel order"
        destructive
        loading={!!cancelTarget && busyId === cancelTarget.id}
      />
    </Page>
  );
}
