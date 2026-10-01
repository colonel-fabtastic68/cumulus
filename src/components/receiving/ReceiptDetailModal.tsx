"use client";

import Link from "next/link";
import type { Receipt } from "@/lib/types";
import { useCollection, useSettings } from "@/lib/store/provider";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatQty, formatRelative, pluralize } from "@/lib/format";
import { sum } from "@/lib/utils";
import { Badge, Button, ConfirmDialog, DescriptionList, Modal, SimpleTable, StatusBadge, useToast } from "@/components/ui";
import { Ban } from "lucide-react";
import { useMemo, useState } from "react";
import { voidReceipt } from "@/lib/inventory";
import { lotLabel } from "@/lib/traceability";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useStore } from "@/lib/store/provider";
import { isBackDated, receiptTotal, type ReceiptLookups } from "./receiptUtils";
import { ReceiptChecklist } from "./ReceiptChecklist";

interface ReceiptDetailModalProps {
  receipt: Receipt | null;
  lookups: ReceiptLookups;
  onClose: () => void;
}

/** Mounts only while a receipt is selected so the modal always reflects the chosen record. */
export function ReceiptDetailModal({ receipt, lookups, onClose }: ReceiptDetailModalProps) {
  if (!receipt) return null;
  return <ReceiptDetail receipt={receipt} lookups={lookups} onClose={onClose} />;
}

function ReceiptDetail({ receipt, lookups, onClose }: { receipt: Receipt; lookups: ReceiptLookups; onClose: () => void }) {
  const { currency } = useSettings();
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const lots = useCollection("lots");
  const purchaseOrders = useCollection("purchaseOrders");
  const lotById = useMemo(() => new Map(lots.map((l) => [l.id, l])), [lots]);
  const poById = useMemo(() => new Map(purchaseOrders.map((p) => [p.id, p])), [purchaseOrders]);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const doVoid = async () => {
    setVoiding(true);
    try {
      await voidReceipt(store, user, receipt.id);
      toast(`${receipt.number} voided; stock adjusted back out`, "success");
      setConfirmVoid(false);
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setVoiding(false);
    }
  };
  const supplier = receipt.supplierId ? lookups.suppliersById.get(receipt.supplierId) : undefined;
  const recordedBy = lookups.membersById.get(receipt.createdBy);
  const total = receiptTotal(receipt);
  const units = sum(receipt.lines.map((l) => l.qty));
  const backDated = isBackDated(receipt);
  const orderIds = receipt.purchaseOrderIds ?? [];
  const showOrders = orderIds.length > 1 || receipt.lines.some((l) => l.purchaseOrderId);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-mono">{receipt.number}</span>
          <StatusBadge status={receipt.status} />
          {backDated && <Badge tone="warning">Back-dated</Badge>}
        </span>
      }
      subtitle={[supplier?.name ?? "No supplier", receipt.reference].filter(Boolean).join(" · ")}
      footer={
        <>
          <div className="mr-auto text-[13px] text-text-secondary">
            {pluralize(receipt.lines.length, "line")} · {formatNumber(units)} units · Total{" "}
            <span className="font-semibold text-text tabular">{formatMoney(total, currency)}</span>
          </div>
          {canWrite(user) && receipt.status === "received" && (
            <Button icon={<Ban />} className="text-critical" onClick={() => setConfirmVoid(true)}>
              Void receipt
            </Button>
          )}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <ConfirmDialog
        open={confirmVoid}
        onClose={() => setConfirmVoid(false)}
        onConfirm={() => void doVoid()}
        destructive
        loading={voiding}
        title={`Void ${receipt.number}?`}
        confirmLabel="Void receipt"
        message={<>Every line&apos;s quantity is adjusted back out of stock from the batches this receipt created, and the receipt stays on record as voided. Use this for receipts entered in error; goods actually returned to a supplier should be written off instead.</>}
      />
      <div className="flex flex-col gap-4">
        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <DescriptionList
            rows={[
              { label: "Supplier", value: supplier?.name ?? "—" },
              { label: "Reference", value: receipt.reference ?? "—" },
              { label: "Received", value: formatDate(receipt.receivedAt) },
              ...(orderIds.length
                ? [
                    {
                      label: orderIds.length === 1 ? "Purchase order" : "Purchase orders",
                      value: (
                        <span className="inline-flex flex-wrap gap-x-2">
                          {orderIds.map((id) => (
                            <Link key={id} href={`/orders/purchase?highlight=${id}`} className="font-mono text-accent hover:underline">
                              {poById.get(id)?.number ?? "Order"}
                            </Link>
                          ))}
                        </span>
                      ),
                    },
                  ]
                : []),
            ]}
          />
          <DescriptionList
            rows={[
              { label: "Recorded by", value: recordedBy?.name ?? "—" },
              {
                label: "Recorded",
                value: <span title={formatDateTime(receipt.createdAt)}>{formatRelative(receipt.createdAt)}</span>,
              },
              { label: "Batches created", value: formatNumber(receipt.lines.filter((l) => l.lotId).length) },
            ]}
          />
        </div>

        <SimpleTable>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Item</th>
              {showOrders && <th>Order</th>}
              <th className="text-right">Qty</th>
              <th className="text-right">Unit cost</th>
              <th className="text-right">Total</th>
              <th>Batch</th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((line, i) => {
              const item = lookups.itemsById.get(line.itemId);
              const lot = line.lotId ? lotById.get(line.lotId) : undefined;
              const supplierLot = line.supplierLot ?? lot?.supplierLot;
              const expiresAt = line.expiresAt ?? lot?.expiresAt;
              return (
                <tr key={line.lotId ?? `${line.itemId}-${i}`}>
                  <td className="whitespace-nowrap">
                    {item ? (
                      <Link href={"/inventory/" + item.id} className="font-mono text-[12px] text-accent hover:underline">
                        {item.sku}
                      </Link>
                    ) : (
                      <span className="font-mono text-[12px] text-text-tertiary">{line.itemId}</span>
                    )}
                  </td>
                  <td className="max-w-[260px] truncate">{item?.name ?? <span className="text-text-tertiary">Unknown item</span>}</td>
                  {showOrders && <td className="whitespace-nowrap font-mono text-[12px] text-text-secondary">{line.purchaseOrderId ? (poById.get(line.purchaseOrderId)?.number ?? "—") : "—"}</td>}
                  <td className="text-right tabular whitespace-nowrap">{formatQty(line.qty, item?.unit)}</td>
                  <td className="text-right tabular whitespace-nowrap">{formatMoney(line.unitCost, currency)}</td>
                  <td className="text-right tabular whitespace-nowrap font-medium">{formatMoney(line.qty * line.unitCost, currency)}</td>
                  <td>
                    {line.lotId ? (
                      <span className="block min-w-0">
                        <Link href={`/reports?tab=traceability&lot=${encodeURIComponent(line.lotId)}`} className="font-mono text-[12px] text-accent hover:underline" title="Trace this batch">
                          {lot ? lotLabel(lot) : lotLabel({ id: line.lotId })}
                        </Link>
                        {(supplierLot || expiresAt) && (
                          <span className="block text-[11.5px] text-text-tertiary">
                            {supplierLot ? `Supplier lot ${supplierLot}` : ""}
                            {supplierLot && expiresAt ? " · " : ""}
                            {expiresAt ? `expires ${formatDate(expiresAt)}` : ""}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-text-tertiary">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={showOrders ? 5 : 4} className="text-right font-medium text-text-secondary">
                Total
              </td>
              <td className="text-right tabular font-semibold">{formatMoney(total, currency)}</td>
              <td />
            </tr>
          </tfoot>
        </SimpleTable>

        {receipt.status === "received" && <ReceiptChecklist receipt={receipt} lookups={lookups} />}

        {receipt.note && (
          <div className="rounded-[var(--radius-sm)] bg-surface-subdued px-3 py-2 text-[12.5px]">
            <div className="text-text-secondary">Note</div>
            <div className="mt-0.5 whitespace-pre-wrap text-text">{receipt.note}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}
