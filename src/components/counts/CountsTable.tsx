"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ListChecks } from "lucide-react";
import type { CycleCount } from "@/lib/types";
import { countProgress, describeScope } from "@/lib/cycleCounts";
import { useLocationName } from "@/lib/locations";
import { formatDateTime, formatMoney, formatRelative } from "@/lib/format";
import { useSettings } from "@/lib/store/provider";
import { matches } from "@/lib/utils";
import { Button, EmptyState, SearchField, Segmented, Table, type Column } from "@/components/ui";
import { CountStatusBadge } from "./countUtils";

type Filter = "open" | "completed" | "all";

export function CountsTable({ counts, onOpen, onNew }: { counts: CycleCount[]; onOpen: (c: CycleCount) => void; onNew?: () => void }) {
  const locationName = useLocationName();
  const { currency } = useSettings();
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const rows = useMemo(() => {
    let list = filter === "all" ? counts : counts.filter((c) => c.status === filter);
    if (q.trim()) list = list.filter((c) => matches(q, c.number, c.name, describeScope(c.scope), locationName(c.locationId)));
    return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [counts, filter, q, locationName]);
  const counts_ = useMemo(() => ({ open: counts.filter((c) => c.status === "open").length, completed: counts.filter((c) => c.status === "completed").length, all: counts.length }), [counts]);

  const columns = useMemo<Column<CycleCount>[]>(
    () => [
      { key: "number", header: "Number", render: (c) => <Link href={`/inventory/counts/${c.id}`} className="font-mono text-[12px] text-accent hover:underline" onClick={(e) => e.stopPropagation()}>{c.number}</Link>, sortValue: (c) => c.number, width: "110px" },
      { key: "scope", header: "What", render: (c) => <span className="block max-w-[280px] truncate">{c.name ? `${c.name} · ` : ""}{describeScope(c.scope)}</span>, sortValue: (c) => c.name ?? describeScope(c.scope) },
      { key: "location", header: "Location", render: (c) => locationName(c.locationId), sortValue: (c) => locationName(c.locationId), hideBelow: "md" },
      {
        key: "progress",
        header: "Counted",
        align: "right",
        render: (c) => {
          const p = countProgress(c);
          return <span className="tabular">{p.counted} / {p.total}</span>;
        },
        sortValue: (c) => countProgress(c).counted / Math.max(1, countProgress(c).total),
      },
      {
        key: "variance",
        header: "Variance",
        align: "right",
        render: (c) => (c.result ? <span className={`tabular ${c.result.varianceValue < 0 ? "text-critical" : c.result.varianceValue > 0 ? "text-success" : "text-text-secondary"}`}>{c.result.varianceUnits >= 0 ? "+" : ""}{c.result.varianceUnits} · {formatMoney(c.result.varianceValue, currency)}</span> : <span className="text-text-tertiary">—</span>),
        sortValue: (c) => c.result?.varianceValue ?? null,
        hideBelow: "md",
      },
      { key: "status", header: "Status", render: (c) => <CountStatusBadge status={c.status} />, sortValue: (c) => c.status },
      { key: "created", header: "Started", render: (c) => <span className="text-text-secondary" title={formatDateTime(c.createdAt)}>{formatRelative(c.createdAt)}</span>, sortValue: (c) => c.createdAt, hideBelow: "lg" },
    ],
    [locationName, currency],
  );

  let empty: ReactNode;
  if (q.trim()) empty = <EmptyState icon={<ListChecks />} title="No counts match" action={<Button size="sm" onClick={() => setQ("")}>Clear search</Button>} />;
  else empty = <EmptyState icon={<ListChecks />} title={counts.length ? "No open counts" : "No cycle counts yet"} description="Count a few bins at a time instead of shutting down for a full stocktake. Start with the bins that move most, or let Strato propose a list." action={onNew ? <Button variant="primary" size="sm" onClick={onNew}>New count</Button> : undefined} />;

  return (
    <Table
      rows={rows}
      columns={columns}
      rowKey={(c) => c.id}
      onRowClick={onOpen}
      defaultSort={{ key: "created", dir: "desc" }}
      pageSize={25}
      emptyState={empty}
      toolbar={
        <div className="flex w-full flex-wrap items-center gap-2">
          <Segmented value={filter} onChange={setFilter} options={[{ value: "open", label: "Open", count: counts_.open }, { value: "completed", label: "Completed", count: counts_.completed }, { value: "all", label: "All", count: counts_.all }]} />
          <SearchField value={q} onChange={setQ} placeholder="Search number, name, bin or location" className="w-full sm:ml-auto sm:w-72" />
        </div>
      }
      footer={`${rows.length} count${rows.length === 1 ? "" : "s"}`}
    />
  );
}
