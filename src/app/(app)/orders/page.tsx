"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { BookmarkPlus, ChevronDown, Plus, Trash2 } from "lucide-react";
import type { OrderTemplate, SalesOrder } from "@/lib/types";
import { cancelOrder } from "@/lib/inventory";
import { deleteOrderTemplate } from "@/lib/orderTemplates";
import { formatDate, pluralize } from "@/lib/format";
import { useCollection, useItemsById, useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { Button, ConfirmDialog, EmptyState, Menu, Modal, Page, QueryParamEffect, useToast } from "@/components/ui";
import { NewOrderModal, OrderDetailModal, OrderStats, OrdersTable, ShipOrderModal } from "@/components/orders";

export default function OrdersPage() {
  const orders = useCollection("orders");
  const itemsById = useItemsById();
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const writable = canWrite(user);
  const { setPageContext } = useAgent();

  const [creating, setCreating] = useState(false);
  const templates = useCollection("orderTemplates");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [manageTemplates, setManageTemplates] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState<OrderTemplate | null>(null);
  const sortedTemplates = useMemo(() => [...templates].sort((a, b) => a.name.localeCompare(b.name)), [templates]);
  const template = useMemo(() => (templateId ? (templates.find((t) => t.id === templateId) ?? null) : null), [templates, templateId]);
  const startFromTemplate = (id: string) => {
    setManageTemplates(false);
    setTemplateId(id);
    setCreating(true);
  };
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<SalesOrder | null>(null);
  const [shipTarget, setShipTarget] = useState<SalesOrder | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const selected = useMemo(() => (selectedId ? (orders.find((o) => o.id === selectedId) ?? null) : null), [orders, selectedId]);

  const selectedSkus = useMemo(() => {
    if (!selected) return undefined;
    return selected.lines.map((l) => itemsById.get(l.itemId)?.sku).filter((s): s is string => !!s);
  }, [selected, itemsById]);

  useEffect(() => {
    setPageContext({ page: "Orders", selectedSkus });
  }, [setPageContext, selectedSkus]);


  // "?ship=<orderId>" opens the ship modal straight away.
  const onShipParam = useCallback(
    (id: string) => {
      const order = orders.find((o) => o.id === id);
      if (order && writable) setShipTarget((current) => (current?.id === order.id ? current : order));
    },
    [orders, writable],
  );

  // Shipping goes through the ship modal: pick quantities and a location, enter tracking or buy a label.
  const fulfil = useCallback(
    (order: SalesOrder) => {
      if (!writable) return;
      setShipTarget(order);
    },
    [writable],
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
    <Page
      title="Orders"
      subtitle="Sales orders relieve stock when shipped"
      primaryAction={newOrderButton}
      secondaryActions={
        writable ? (
          <Menu
            align="right"
            trigger={
              <Button icon={<BookmarkPlus />} iconRight={<ChevronDown />}>
                From template
              </Button>
            }
            items={[
              ...(sortedTemplates.length
                ? sortedTemplates.map((t) => ({
                    label: (
                      <span className="block min-w-0">
                        <span className="block truncate">{t.name}</span>
                        <span className="block text-[11px] text-text-tertiary">
                          {t.customer ? `${t.customer} · ` : ""}
                          {pluralize(t.lines.length, "line")}
                          {t.description ? ` · ${t.description}` : ""}
                        </span>
                      </span>
                    ),
                    onSelect: () => startFromTemplate(t.id),
                  }))
                : [{ label: <span className="text-text-tertiary">No templates yet. Open New order and choose “Save as template”.</span>, disabled: true }]),
              "divider" as const,
              { label: "Manage templates", onSelect: () => setManageTemplates(true) },
            ]}
          />
        ) : undefined
      }
    >
      {/* "?highlight=<orderId>" opens that order, also when navigating here while already on the page. */}
      <Suspense fallback={null}>
        <QueryParamEffect param="highlight" onValue={setSelectedId} />
        <QueryParamEffect param="ship" onValue={onShipParam} />
      </Suspense>
      <div className="flex flex-col gap-4">
        <OrderStats orders={orders} />
        <OrdersTable orders={orders} canWrite={writable} busyId={busyId} onSelect={(o) => setSelectedId(o.id)} onFulfil={fulfil} onCancel={requestCancel} onNew={writable ? () => setCreating(true) : undefined} />
      </div>

      <NewOrderModal
        open={creating}
        template={template}
        onClose={() => {
          setCreating(false);
          setTemplateId(null);
        }}
        onCreated={(order) => setSelectedId(order.id)}
      />
      <Modal open={manageTemplates} onClose={() => setManageTemplates(false)} size="md" title="Order templates" subtitle="Saved customers, lines and notes. Start an order from one and adjust it." footer={<Button onClick={() => setManageTemplates(false)}>Close</Button>}>
        {sortedTemplates.length === 0 ? (
          <EmptyState icon={<BookmarkPlus />} title="No templates yet" description="Open New order, fill it in, and choose “Save as template” in the footer." />
        ) : (
          <ul className="divide-y divide-border">
            {sortedTemplates.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-text">{t.name}</div>
                  <div className="truncate text-[12px] text-text-secondary">
                    {t.customer ? `${t.customer} · ` : ""}
                    {pluralize(t.lines.length, "line")} · saved {formatDate(t.updatedAt)}
                    {t.description ? ` · ${t.description}` : ""}
                  </div>
                </div>
                <Button size="sm" onClick={() => startFromTemplate(t.id)}>
                  Use
                </Button>
                <Button size="sm" variant="plain" icon={<Trash2 />} className="text-critical" onClick={() => setDeletingTemplate(t)} aria-label={`Delete ${t.name}`} />
              </li>
            ))}
          </ul>
        )}
      </Modal>
      <ConfirmDialog
        open={!!deletingTemplate}
        onClose={() => setDeletingTemplate(null)}
        destructive
        title={`Delete template “${deletingTemplate?.name}”?`}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!deletingTemplate) return;
          await deleteOrderTemplate(store, deletingTemplate.id);
          toast("Template deleted", "success");
          setDeletingTemplate(null);
        }}
        message={<>Orders already created from it are not affected.</>}
      />

      <OrderDetailModal order={selected} onClose={() => setSelectedId(null)} canWrite={writable} busy={!!selected && busyId === selected.id} onFulfil={fulfil} onCancel={requestCancel} />

      <ShipOrderModal order={shipTarget} onClose={() => setShipTarget(null)} />

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
