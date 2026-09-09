"use client";

import { useState } from "react";
import Link from "next/link";
import { PackageCheck, XCircle } from "lucide-react";
import type { Transfer } from "@/lib/types";
import { cancelTransfer, receiveTransfer } from "@/lib/inventory";
import { useLocationName } from "@/lib/locations";
import { useCollection, useItemsById, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { formatDateTime, formatQty, formatRelative, pluralize } from "@/lib/format";
import { Badge, Banner, Button, DescriptionList, Modal, SimpleTable, TextField, useToast } from "@/components/ui";
import { TRANSFER_STATUS_LABEL, transferUnits } from "./transferUtils";

export function TransferDetailModal({ transfer, onClose, canWrite }: { transfer: Transfer | null; onClose: () => void; canWrite: boolean }) {
  if (!transfer) return null;
  return <Detail key={transfer.id} transfer={transfer} onClose={onClose} canWrite={canWrite} />;
}

function Detail({ transfer, onClose, canWrite }: { transfer: Transfer; onClose: () => void; canWrite: boolean }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const itemsById = useItemsById();
  const members = useCollection("members");
  const locationName = useLocationName();
  const [received, setReceived] = useState<Record<string, string>>(() => Object.fromEntries(transfer.lines.map((l) => [l.itemId, String(l.qty)])));
  const [busy, setBusy] = useState<"receive" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inTransit = transfer.status === "in_transit";
  const by = (id?: string) => members.find((m) => m.id === id)?.name;

  const receive = async () => {
    setBusy("receive");
    setError(null);
    try {
      const lines = transfer.lines.map((l) => ({ itemId: l.itemId, qty: Number(received[l.itemId] ?? l.qty) }));
      for (const l of lines) if (!Number.isFinite(l.qty) || l.qty < 0) throw new Error("Received quantities must be numbers");
      await receiveTransfer(store, user, transfer.id, lines);
      toast(`Received ${transfer.number}`, "success");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not receive the transfer");
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy("cancel");
    setError(null);
    try {
      await cancelTransfer(store, user, transfer.id);
      toast(`Cancelled ${transfer.number}; stock is back at ${locationName(transfer.fromLocationId)}`, "success");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not cancel the transfer");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="inline-flex items-center gap-2">
          <span className="font-mono">{transfer.number}</span>
          <Badge tone={transfer.status === "in_transit" ? "info" : transfer.status === "received" ? "success" : "default"}>{TRANSFER_STATUS_LABEL[transfer.status]}</Badge>
        </span>
      }
      subtitle={`${locationName(transfer.fromLocationId)} → ${locationName(transfer.toLocationId)}`}
      footer={
        <>
          <div className="mr-auto text-[13px] text-text-secondary">
            {pluralize(transfer.lines.length, "line")} · {pluralize(transferUnits(transfer), "unit")}
          </div>
          <Button onClick={onClose}>Close</Button>
          {inTransit && canWrite && (
            <>
              <Button icon={<XCircle />} className="text-critical" onClick={() => void cancel()} loading={busy === "cancel"} disabled={busy !== null}>
                Cancel transfer
              </Button>
              <Button variant="primary" icon={<PackageCheck />} onClick={() => void receive()} loading={busy === "receive"} disabled={busy !== null}>
                Receive at {locationName(transfer.toLocationId)}
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
              { label: "Sent", value: <span title={formatDateTime(transfer.shippedAt)}>{formatRelative(transfer.shippedAt)}{by(transfer.createdBy) ? ` by ${by(transfer.createdBy)}` : ""}</span> },
              { label: "Received", value: transfer.receivedAt ? <span title={formatDateTime(transfer.receivedAt)}>{formatRelative(transfer.receivedAt)}{by(transfer.receivedBy) ? ` by ${by(transfer.receivedBy)}` : ""}</span> : <span className="text-text-tertiary">Not yet</span> },
            ]}
          />
          <DescriptionList rows={[{ label: "Carrier", value: transfer.carrier ?? <span className="text-text-tertiary">—</span> }, { label: "Tracking", value: transfer.trackingNumber ?? <span className="text-text-tertiary">—</span> }]} />
        </div>
        {transfer.note && <p className="text-[13px] text-text-secondary">{transfer.note}</p>}
        <SimpleTable>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Item</th>
              <th className="text-right">Sent</th>
              <th className="text-right">{inTransit ? "Received now" : "Received"}</th>
            </tr>
          </thead>
          <tbody>
            {transfer.lines.map((l) => {
              const item = itemsById.get(l.itemId);
              return (
                <tr key={l.itemId}>
                  <td>{item ? <Link href={`/inventory/${item.id}`} className="font-mono text-[12px] text-accent hover:underline">{item.sku}</Link> : <span className="font-mono text-[12px] text-text-tertiary">{l.itemId}</span>}</td>
                  <td className="max-w-[240px] truncate text-text-secondary">{item?.name ?? "Item no longer exists"}</td>
                  <td className="text-right tabular">{formatQty(l.qty, item?.unit)}</td>
                  <td className="text-right tabular">
                    {inTransit && canWrite ? (
                      <TextField type="number" min={0} max={l.qty} step="any" value={received[l.itemId] ?? String(l.qty)} onChange={(e) => setReceived((r) => ({ ...r, [l.itemId]: e.target.value }))} aria-label={`Received ${item?.sku ?? ""}`} className="w-24 text-right" containerClassName="ml-auto w-24" />
                    ) : (
                      formatQty(l.receivedQty ?? (transfer.status === "received" ? l.qty : 0), item?.unit)
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </SimpleTable>
        {inTransit && canWrite && <p className="text-[12px] text-text-tertiary">Receive fewer than sent and the difference is written off at the destination, with the reason on the movement.</p>}
        {error && <Banner tone="critical">{error}</Banner>}
      </div>
    </Modal>
  );
}
