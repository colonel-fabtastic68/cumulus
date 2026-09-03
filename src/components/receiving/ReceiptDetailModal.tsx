"use client";

import Link from "next/link";
import type { Receipt } from "@/lib/types";
import { useSettings } from "@/lib/store/provider";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatQty, formatRelative, pluralize } from "@/lib/format";
import { sum } from "@/lib/utils";
import { Badge, Button, DescriptionList, Modal, SimpleTable, StatusBadge } from "@/components/ui";
import { isBackDated, receiptTotal, type ReceiptLookups } from "./receiptUtils";

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
  const supplier = receipt.supplierId ? lookups.suppliersById.get(receipt.supplierId) : undefined;
  const recordedBy = lookups.membersById.get(receipt.createdBy);
  const total = receiptTotal(receipt);
  const units = sum(receipt.lines.map((l) => l.qty));
  const backDated = isBackDated(receipt);

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
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          <DescriptionList
            rows={[
              { label: "Supplier", value: supplier?.name ?? "—" },
              { label: "Reference", value: receipt.reference ?? "—" },
              { label: "Received", value: formatDate(receipt.receivedAt) },
            ]}
          />
          <DescriptionList
            rows={[
              { label: "Recorded by", value: recordedBy?.name ?? "—" },
              {
                label: "Recorded",
                value: <span title={formatDateTime(receipt.createdAt)}>{formatRelative(receipt.createdAt)}</span>,
              },
              { label: "Lots created", value: formatNumber(receipt.lines.filter((l) => l.lotId).length) },
            ]}
          />
        </div>

        <SimpleTable>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Item</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Unit cost</th>
              <th className="text-right">Total</th>
              <th>Lot</th>
            </tr>
          </thead>
          <tbody>
            {receipt.lines.map((line, i) => {
              const item = lookups.itemsById.get(line.itemId);
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
                  <td className="text-right tabular whitespace-nowrap">{formatQty(line.qty, item?.unit)}</td>
                  <td className="text-right tabular whitespace-nowrap">{formatMoney(line.unitCost, currency)}</td>
                  <td className="text-right tabular whitespace-nowrap font-medium">{formatMoney(line.qty * line.unitCost, currency)}</td>
                  <td>
                    <span className="block max-w-[160px] truncate font-mono text-[11.5px] text-text-tertiary" title={line.lotId}>
                      {line.lotId ?? "—"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="text-right font-medium text-text-secondary">
                Total
              </td>
              <td className="text-right tabular font-semibold">{formatMoney(total, currency)}</td>
              <td />
            </tr>
          </tfoot>
        </SimpleTable>

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
