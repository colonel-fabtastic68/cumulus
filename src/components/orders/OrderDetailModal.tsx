"use client";

import { useState } from "react";
import Link from "next/link";
import { ExternalLink, RefreshCw, Truck, XCircle } from "lucide-react";
import type { SalesOrder, Shipment } from "@/lib/types";
import { isOrderOpen, openQty } from "@/lib/inventory";
import { useCollection, useItemsById, useSettings } from "@/lib/store/provider";
import { useSession } from "@/lib/session";
import { useApi } from "@/lib/api-client";
import { formatDateTime, formatMoney, formatNumber, formatQty, formatRelative, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Button, DescriptionList, Modal, SimpleTable, StatusBadge, useToast } from "@/components/ui";
import { orderAvailability, orderOpenUnits, orderTotal, orderUnits, SourceBadge } from "./orderUtils";

interface OrderDetailModalProps {
  order: SalesOrder | null;
  onClose: () => void;
  canWrite: boolean;
  busy?: boolean;
  onFulfil: (order: SalesOrder) => void;
  onCancel: (order: SalesOrder) => void;
}

/** Mounts only while an order is selected and remounts per order so nothing leaks between records. */
export function OrderDetailModal({ order, ...rest }: OrderDetailModalProps) {
  if (!order) return null;
  return <OrderDetail key={order.id} order={order} {...rest} />;
}

function OrderDetail({ order, onClose, canWrite, busy, onFulfil, onCancel }: OrderDetailModalProps & { order: SalesOrder }) {
  const itemsById = useItemsById();
  const members = useCollection("members");
  const { currency } = useSettings();

  const open = isOrderOpen(order);
  const availability = orderAvailability(order, itemsById);
  const shortIds = new Set(order.lines.filter((l) => openQty(l) > 0 && (itemsById.get(l.itemId)?.onHand ?? 0) < openQty(l)).map((l) => l.itemId));
  const shipments = useCollection("shipments").filter((s) => s.orderId === order.id).sort((a, b) => a.shippedAt.localeCompare(b.shippedAt));
  const createdBy = members.find((m) => m.id === order.createdBy)?.name;
  const total = orderTotal(order);
  const units = orderUnits(order);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-mono">{order.number}</span>
          <StatusBadge status={order.status} />
          <SourceBadge source={order.source} />
        </span>
      }
      subtitle={order.customer}
      footer={
        <>
          <div className="mr-auto text-[13px] text-text-secondary">
            {pluralize(order.lines.length, "line")} · {pluralize(units, "unit")} · Total <span className="font-semibold text-text tabular">{formatMoney(total, currency)}</span>
          </div>
          <Button onClick={onClose}>Close</Button>
          {open && canWrite && (
            <>
              <Button icon={<XCircle />} className="text-critical" onClick={() => onCancel(order)} disabled={busy}>
                Cancel order
              </Button>
              <Button variant="primary" icon={<Truck />} onClick={() => onFulfil(order)} loading={busy}>
                {order.status === "partial" ? "Ship the rest" : "Ship"}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <DescriptionList
            rows={[
              { label: "Customer", value: order.customer },
              { label: "Source", value: <SourceBadge source={order.source} /> },
              {
                label: "Availability",
                value: !open ? (
                  <span className="text-text-tertiary">—</span>
                ) : availability.ready ? (
                  <Badge tone="success">Ready to ship</Badge>
                ) : (
                  <Badge tone="warning">Short on {pluralize(availability.short.length, "line")}</Badge>
                ),
              },
            ]}
          />
          <DescriptionList
            rows={[
              {
                label: "Created",
                value: (
                  <span title={formatDateTime(order.createdAt)}>
                    {formatRelative(order.createdAt)}
                    {createdBy ? ` by ${createdBy}` : ""}
                  </span>
                ),
              },
              { label: "Fulfilled", value: order.fulfilledAt ? formatDateTime(order.fulfilledAt) : <span className="text-text-tertiary">{order.status === "cancelled" ? "Cancelled" : order.status === "partial" ? `${formatNumber(orderOpenUnits(order))} of ${formatNumber(units)} units still open` : "Not yet"}</span> },
              { label: "Ship to", value: order.shipTo?.street1 ? <span className="text-[12.5px]">{[order.shipTo.name, order.shipTo.street1, order.shipTo.street2, `${order.shipTo.city}${order.shipTo.state ? ", " + order.shipTo.state : ""} ${order.shipTo.zip}`, order.shipTo.country].filter(Boolean).join(", ")}</span> : <span className="text-text-tertiary">{order.customerEmail ?? "—"}</span> },
            ]}
          />
        </div>

        <div>
          <div className="mb-1.5 text-[13px] font-semibold text-text">Lines</div>
          <SimpleTable>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Item</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Shipped</th>
                <th className="text-right">On hand</th>
                <th className="text-right">Unit price</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((l, i) => {
                const item = itemsById.get(l.itemId);
                const short = open && shortIds.has(l.itemId);
                return (
                  <tr key={`${l.itemId}-${i}`} className={cn(short && "bg-warning-soft/40")}>
                    <td className="align-top">
                      {item ? (
                        <Link href={"/inventory/" + item.id} className="font-mono text-[12px] text-accent hover:underline">
                          {item.sku}
                        </Link>
                      ) : (
                        <span className="font-mono text-[12px] text-text-tertiary">{l.itemId}</span>
                      )}
                    </td>
                    <td className="max-w-[240px] truncate align-top text-text-secondary">{item?.name ?? "Item no longer exists"}</td>
                    <td className="text-right align-top tabular">{formatQty(l.qty, item?.unit)}</td>
                    <td className={cn("text-right align-top tabular", (l.shipped ?? 0) > 0 && openQty(l) > 0 ? "text-attention" : "text-text-secondary")}>{formatQty(l.shipped ?? (order.status === "fulfilled" ? l.qty : 0), item?.unit)}</td>
                    <td className={cn("text-right align-top tabular", short ? "font-medium text-warning" : "text-text-secondary")}>{item ? formatQty(item.onHand, item.unit) : "—"}</td>
                    <td className="text-right align-top tabular">{formatMoney(l.unitPrice, currency)}</td>
                    <td className="text-right align-top font-medium tabular">{formatMoney(l.qty * l.unitPrice, currency)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} className="text-right text-text-secondary">
                  Order total
                </td>
                <td className="text-right font-semibold tabular">{formatMoney(total, currency)}</td>
              </tr>
            </tfoot>
          </SimpleTable>
          {open && !availability.ready && (
            <p className="mt-1.5 text-[12px] text-text-tertiary">
              {availability.short.some((s) => s.isAssembly) ? "Build the short assemblies, or ship what is ready now and leave the rest on backorder. " : "Receive the short parts, or ship what is ready now and leave the rest on backorder. "}
              {availability.short.map((s) => `${s.sku}: have ${formatNumber(s.have)}, need ${formatNumber(s.need)}`).join(" · ")}
            </p>
          )}
        </div>

        {shipments.length > 0 && (
          <div>
            <div className="mb-1.5 text-[13px] font-semibold text-text">Shipments</div>
            <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">
              {shipments.map((s) => (
                <ShipmentRow key={s.id} shipment={s} currency={currency} />
              ))}
            </ul>
          </div>
        )}

        {order.note && (
          <div>
            <div className="mb-1 text-[12.5px] font-medium text-text">Note</div>
            <p className="whitespace-pre-wrap rounded-[var(--radius-sm)] bg-surface-subdued px-3 py-2 text-[13px] text-text-secondary">{order.note}</p>
          </div>
        )}

        {open && !canWrite && <p className="text-[12px] text-text-tertiary">Viewers can see orders but can&apos;t ship or cancel them.</p>}
      </div>
    </Modal>
  );
}

const TRACKING_TONE: Record<string, "default" | "info" | "success" | "warning" | "critical"> = { delivered: "success", transit: "info", in_transit: "info", out_for_delivery: "info", pre_transit: "default", failure: "critical", failed: "critical", returned: "warning", unknown: "default" };

function ShipmentRow({ shipment, currency }: { shipment: Shipment; currency: string }) {
  const itemsById = useItemsById();
  const { mode } = useSession();
  const api = useApi();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const units = shipment.lines.reduce((a, l) => a + l.qty, 0);
  const canRefresh = mode === "firestore" && shipment.provider && shipment.provider !== "manual" && !!shipment.trackingNumber;

  const refresh = async () => {
    setBusy(true);
    try {
      const res = await api<{ status?: string }>("/api/shipping/track", { shipmentId: shipment.id });
      toast(res.status ? `Tracking: ${res.status.replace(/_/g, " ")}` : "Tracking refreshed", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not refresh tracking", "critical");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-[12.5px]">
      <span className="font-mono font-medium text-text">{shipment.number}</span>
      <span className="text-text-secondary" title={formatDateTime(shipment.shippedAt)}>
        {formatRelative(shipment.shippedAt)}
      </span>
      <span className="text-text-secondary" title={shipment.lines.map((l) => `${itemsById.get(l.itemId)?.sku ?? l.itemId} × ${l.qty}`).join(", ")}>
        {pluralize(units, "unit")} on {pluralize(shipment.lines.length, "line")}
      </span>
      {(shipment.carrier || shipment.service) && <span className="text-text">{[shipment.carrier, shipment.service].filter(Boolean).join(" ")}</span>}
      {shipment.trackingNumber &&
        (shipment.trackingUrl ? (
          <a href={shipment.trackingUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-accent hover:underline">
            {shipment.trackingNumber} <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className="font-mono">{shipment.trackingNumber}</span>
        ))}
      {shipment.trackingStatus && <Badge tone={TRACKING_TONE[shipment.trackingStatus.toLowerCase()] ?? "default"}>{shipment.trackingStatus.replace(/_/g, " ")}</Badge>}
      {shipment.cost !== undefined && <span className="tabular text-text-secondary">{formatMoney(shipment.cost, shipment.currency ?? currency)}</span>}
      <span className="ml-auto flex items-center gap-1">
        {shipment.labelUrl && (
          <a href={shipment.labelUrl} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[12.5px] font-medium text-accent hover:bg-surface-hover">
            Label <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {canRefresh && (
          <Button size="sm" variant="plain" icon={<RefreshCw />} onClick={() => void refresh()} loading={busy}>
            Track
          </Button>
        )}
      </span>
    </li>
  );
}
