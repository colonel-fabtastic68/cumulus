"use client";

import { useMemo, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import type { Transfer } from "@/lib/types";
import { useLocationName } from "@/lib/locations";
import { formatDate, formatDateTime, formatNumber, formatRelative, pluralize } from "@/lib/format";
import { matches } from "@/lib/utils";
import { Badge, Button, EmptyState, SearchField, Segmented, Table, type Column } from "@/components/ui";
import { TRANSFER_STATUS_LABEL, transferUnits, type TransferFilter } from "./transferUtils";

const FILTERS: Array<{ value: TransferFilter; label: string }> = [
  { value: "in_transit", label: "In transit" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" },
  { value: "all", label: "All" },
];

export function TransfersTable({ transfers, onSelect, onNew }: { transfers: Transfer[]; onSelect: (t: Transfer) => void; onNew?: () => void }) {
  const locationName = useLocationName();
  const [filter, setFilter] = useState<TransferFilter>("in_transit");
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const c = { in_transit: 0, received: 0, cancelled: 0, all: transfers.length };
    for (const t of transfers) c[t.status]++;
    return c;
  }, [transfers]);

  const rows = useMemo(() => {
    let list = filter === "all" ? transfers : transfers.filter((t) => t.status === filter);
    if (q.trim()) list = list.filter((t) => matches(q, t.number, locationName(t.fromLocationId), locationName(t.toLocationId), t.trackingNumber, t.carrier));
    return [...list].sort((a, b) => b.shippedAt.localeCompare(a.shippedAt));
  }, [transfers, filter, q, locationName]);

  const columns = useMemo<Column<Transfer>[]>(
    () => [
      { key: "number", header: "Transfer", render: (t) => <span className="font-mono text-[12px] font-medium text-text">{t.number}</span>, sortValue: (t) => t.number },
      { key: "route", header: "Route", render: (t) => <span>{locationName(t.fromLocationId)} <span className="text-text-tertiary">→</span> {locationName(t.toLocationId)}</span>, sortValue: (t) => locationName(t.fromLocationId) },
      { key: "lines", header: "Lines", align: "right", render: (t) => <span className="tabular">{t.lines.length} · {formatNumber(transferUnits(t))} units</span>, sortValue: (t) => transferUnits(t), hideBelow: "sm" },
      { key: "status", header: "Status", render: (t) => <Badge tone={t.status === "in_transit" ? "info" : t.status === "received" ? "success" : "default"}>{TRANSFER_STATUS_LABEL[t.status]}</Badge>, sortValue: (t) => t.status },
      { key: "carrier", header: "Carrier", render: (t) => (t.carrier || t.trackingNumber ? <span className="text-text-secondary">{[t.carrier, t.trackingNumber].filter(Boolean).join(" · ")}</span> : <span className="text-text-tertiary">—</span>), hideBelow: "lg" },
      { key: "sent", header: "Sent", render: (t) => <span className="text-text-secondary" title={formatDateTime(t.shippedAt)}>{formatRelative(t.shippedAt)}</span>, sortValue: (t) => t.shippedAt, hideBelow: "md" },
      { key: "received", header: "Received", render: (t) => <span className="text-text-secondary">{t.receivedAt ? formatDate(t.receivedAt) : "—"}</span>, sortValue: (t) => t.receivedAt ?? null, hideBelow: "lg" },
    ],
    [locationName],
  );

  return (
    <Table
      rows={rows}
      columns={columns}
      rowKey={(t) => t.id}
      onRowClick={onSelect}
      pageSize={25}
      defaultSort={{ key: "sent", dir: "desc" }}
      toolbar={
        <>
          <SearchField value={q} onChange={setQ} placeholder="Search number, location, tracking" className="w-full sm:w-64" />
          <Segmented value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ ...f, count: counts[f.value] }))} />
        </>
      }
      footer={`${pluralize(rows.length, "transfer")} shown`}
      emptyState={<EmptyState icon={<ArrowLeftRight />} title={transfers.length ? "No transfers match" : "No transfers yet"} description={transfers.length ? "Try another filter." : "Move stock between locations and it shows up here, in transit until it is received."} action={onNew && !transfers.length ? <Button variant="primary" onClick={onNew}>New transfer</Button> : undefined} />}
    />
  );
}
