"use client";

import Link from "next/link";
import { PackageCheck, XCircle } from "lucide-react";
import type { SalesOrder } from "@/lib/types";
import { useCollection, useItemsById, useSettings } from "@/lib/store/provider";
import { formatDateTime, formatMoney, formatNumber, formatQty, formatRelative, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge, Button, DescriptionList, Modal, SimpleTable, StatusBadge } from "@/components/ui";
import { orderAvailability, orderTotal, orderUnits, SourceBadge } from "./orderUtils";

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

  const open = order.status === "open";
  const availability = orderAvailability(order, itemsById);
  const shortIds = new Set(order.lines.filter((l) => (itemsById.get(l.itemId)?.onHand ?? 0) < l.qty).map((l) => l.itemId));
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
              <Button variant="primary" icon={<PackageCheck />} onClick={() => onFulfil(order)} loading={busy}>
                Fulfil
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
              { label: "Fulfilled", value: order.fulfilledAt ? formatDateTime(order.fulfilledAt) : <span className="text-text-tertiary">{order.status === "cancelled" ? "Cancelled" : "Not yet"}</span> },
              { label: "Units", value: formatNumber(units) },
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
                    <td className={cn("text-right align-top tabular", short ? "font-medium text-warning" : "text-text-secondary")}>{item ? formatQty(item.onHand, item.unit) : "—"}</td>
                    <td className="text-right align-top tabular">{formatMoney(l.unitPrice, currency)}</td>
                    <td className="text-right align-top font-medium tabular">{formatMoney(l.qty * l.unitPrice, currency)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5} className="text-right text-text-secondary">
                  Order total
                </td>
                <td className="text-right font-semibold tabular">{formatMoney(total, currency)}</td>
              </tr>
            </tfoot>
          </SimpleTable>
          {open && !availability.ready && (
            <p className="mt-1.5 text-[12px] text-text-tertiary">
              {availability.short.some((s) => s.isAssembly) ? "Build the short assemblies before fulfilling. " : "Receive the short parts before fulfilling. "}
              {availability.short.map((s) => `${s.sku}: have ${formatNumber(s.have)}, need ${formatNumber(s.need)}`).join(" · ")}
            </p>
          )}
        </div>

        {order.note && (
          <div>
            <div className="mb-1 text-[12.5px] font-medium text-text">Note</div>
            <p className="whitespace-pre-wrap rounded-[var(--radius-sm)] bg-surface-subdued px-3 py-2 text-[13px] text-text-secondary">{order.note}</p>
          </div>
        )}

        {open && !canWrite && <p className="text-[12px] text-text-tertiary">Viewers can see orders but can&apos;t fulfil or cancel them.</p>}
      </div>
    </Modal>
  );
}
