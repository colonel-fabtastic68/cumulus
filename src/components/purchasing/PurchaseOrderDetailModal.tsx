"use client";

import Link from "next/link";
import { BookmarkPlus, PackageCheck, Pencil, Printer, Send, XCircle } from "lucide-react";
import type { PurchaseOrder } from "@/lib/types";
import { poIsOpen, poIsOverdue, poLineOpenQty, poReceivedUnits, poTotal } from "@/lib/purchaseOrders";
import { useCollection, useItemsById, useSettings } from "@/lib/store/provider";
import { formatDate, formatDateTime, formatMoney, formatRelative, pluralize } from "@/lib/format";
import { Badge, Button, DescriptionList, Modal, SimpleTable, useToast } from "@/components/ui";
import { PoStatusBadge, printPurchaseOrder } from "./poUtils";

interface Props {
  po: PurchaseOrder | null;
  onClose: () => void;
  canWrite: boolean;
  busy?: boolean;
  onSend: (po: PurchaseOrder) => void;
  onReceive: (po: PurchaseOrder) => void;
  onEdit: (po: PurchaseOrder) => void;
  onCancel: (po: PurchaseOrder) => void;
  onSaveTemplate: (po: PurchaseOrder) => void;
}

export function PurchaseOrderDetailModal({ po, ...rest }: Props) {
  if (!po) return null;
  return <Detail key={po.id} po={po} {...rest} />;
}

function Detail({ po, onClose, canWrite, busy, onSend, onReceive, onEdit, onCancel, onSaveTemplate }: Props & { po: PurchaseOrder }) {
  const itemsById = useItemsById();
  const members = useCollection("members");
  const suppliers = useCollection("suppliers");
  const receipts = useCollection("receipts").filter((r) => po.receiptIds?.includes(r.id));
  const settings = useSettings();
  const toast = useToast();
  const supplier = suppliers.find((s) => s.id === po.supplierId);
  const createdBy = members.find((m) => m.id === po.createdBy)?.name;
  const open = poIsOpen(po);
  const editable = open && poReceivedUnits(po) === 0;

  const print = () => {
    if (!printPurchaseOrder(po, { items: itemsById, settings, supplier })) toast("Allow pop-ups to print the order", "critical");
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="font-mono">{po.number}</span>
          <PoStatusBadge status={po.status} />
          {poIsOverdue(po) && <Badge tone="warning">Overdue</Badge>}
        </span>
      }
      subtitle={po.supplier}
      footer={
        <>
          <Button variant="plain" icon={<Printer />} onClick={print} className="mr-auto">
            Print / PDF
          </Button>
          {canWrite && (
            <Button variant="plain" icon={<BookmarkPlus />} onClick={() => onSaveTemplate(po)}>
              Save as template
            </Button>
          )}
          {canWrite && editable && (
            <Button icon={<Pencil />} onClick={() => onEdit(po)} disabled={busy}>
              Edit
            </Button>
          )}
          {canWrite && open && (
            <Button icon={<XCircle />} onClick={() => onCancel(po)} disabled={busy}>
              Cancel order
            </Button>
          )}
          {canWrite && po.status === "draft" && (
            <Button icon={<Send />} onClick={() => onSend(po)} disabled={busy}>
              Mark as sent
            </Button>
          )}
          {canWrite && open ? (
            <Button variant="primary" icon={<PackageCheck />} onClick={() => onReceive(po)} loading={busy}>
              {po.status === "partial" ? "Receive the rest" : "Receive"}
            </Button>
          ) : (
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <DescriptionList
          rows={[
            {
              label: "Supplier",
              value: supplier ? (
                <Link href={`/suppliers?highlight=${supplier.id}`} className="text-accent hover:underline">
                  {supplier.name}
                </Link>
              ) : (
                po.supplier
              ),
            },
            { label: "Expected", value: po.expectedAt ? formatDate(po.expectedAt) : "—" },
            { label: "Terms", value: po.terms ?? "—" },
            { label: "Reference", value: po.reference ?? "—" },
            { label: "Created", value: <span title={formatDateTime(po.createdAt)}>{formatRelative(po.createdAt)}{createdBy ? ` by ${createdBy}` : ""}</span> },
            ...(po.sentAt ? [{ label: "Sent", value: formatDateTime(po.sentAt) }] : []),
            ...(po.receivedAt ? [{ label: "Completed", value: formatDateTime(po.receivedAt) }] : []),
            ...(po.cancelledAt ? [{ label: "Cancelled", value: formatDateTime(po.cancelledAt) }] : []),
            ...(po.templateId ? [{ label: "Source", value: "Template" }] : po.source && po.source !== "manual" ? [{ label: "Source", value: po.source === "strato" ? "Strato" : "Low-stock suggestion" }] : []),
          ]}
        />
        <SimpleTable>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Item</th>
              <th>Supplier SKU</th>
              <th className="text-right">Ordered</th>
              <th className="text-right">Received</th>
              <th className="text-right">Open</th>
              <th className="text-right">Unit cost</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l) => {
              const item = itemsById.get(l.itemId);
              const openQty = poLineOpenQty(l);
              return (
                <tr key={l.itemId}>
                  <td className="font-mono text-[12.5px]">{item ? <Link href={`/inventory/${item.id}`} className="text-accent hover:underline">{item.sku}</Link> : l.itemId}</td>
                  <td>
                    {item?.name ?? ""}
                    {l.note && <div className="text-[12px] text-text-tertiary">{l.note}</div>}
                  </td>
                  <td className="font-mono text-[12.5px] text-text-secondary">{l.supplierSku ?? "—"}</td>
                  <td className="text-right tabular">{l.qty}</td>
                  <td className="text-right tabular">{l.received ?? 0}</td>
                  <td className={`text-right tabular ${openQty > 0 && po.status !== "cancelled" ? "text-warning" : "text-text-secondary"}`}>{po.status === "cancelled" ? "—" : openQty}</td>
                  <td className="text-right tabular">{formatMoney(l.unitCost, settings.currency)}</td>
                  <td className="text-right tabular">{formatMoney(l.qty * l.unitCost, settings.currency)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7} className="text-right font-medium">
                Total
              </td>
              <td className="text-right font-semibold tabular">{formatMoney(poTotal(po), settings.currency)}</td>
            </tr>
          </tfoot>
        </SimpleTable>
        {receipts.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Receipts</h4>
            <ul className="flex flex-col gap-1 text-[13px]">
              {receipts
                .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
                .map((r) => (
                  <li key={r.id}>
                    <Link href={`/receiving?highlight=${r.id}`} className="font-mono text-accent hover:underline">
                      {r.number}
                    </Link>
                    <span className="text-text-secondary">
                      {" "}
                      · {formatDate(r.receivedAt)} · {pluralize(r.lines.length, "line")}
                      {r.status === "voided" ? " · voided" : ""}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        )}
        {po.note && (
          <div>
            <h4 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Note</h4>
            <p className="whitespace-pre-line text-[13px] text-text">{po.note}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
