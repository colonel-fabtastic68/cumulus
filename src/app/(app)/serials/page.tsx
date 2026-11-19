"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Hash } from "lucide-react";
import type { Serial } from "@/lib/types";
import { useCollection, useItemsById } from "@/lib/store/provider";
import { useAgent } from "@/components/agent/AgentProvider";
import { useFeature } from "@/lib/useFeature";
import { useLocationName } from "@/lib/locations";
import { formatDate } from "@/lib/format";
import { matches } from "@/lib/utils";
import { Button, Card, EmptyState, Page, SearchField, Segmented, Table, type Column } from "@/components/ui";
import { serialHref, SerialStatusBadge } from "@/components/serials/SerialStatusBadge";

type Filter = "making" | "in_stock" | "installed" | "shipped" | "all";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "making", label: "Being made" },
  { value: "in_stock", label: "In stock" },
  { value: "installed", label: "Built in" },
  { value: "shipped", label: "Shipped" },
  { value: "all", label: "All" },
];

function inFilter(s: Serial, f: Filter): boolean {
  if (f === "all") return s.status !== "voided";
  if (f === "making") return s.status === "planned" || s.status === "in_production";
  return s.status === f;
}

/** Every serial-numbered unit (feature `serials`). */
export default function SerialsPage() {
  const enabled = useFeature("serials");
  const router = useRouter();
  const serials = useCollection("serials");
  const workOrders = useCollection("workOrders");
  const itemsById = useItemsById();
  const locationName = useLocationName();
  const { setPageContext } = useAgent();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    setPageContext({ page: "Serial numbers" });
  }, [setPageContext]);

  const serialsById = useMemo(() => new Map(serials.map((s) => [s.id, s])), [serials]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, serials.filter((s) => inFilter(s, f.value)).length])) as Record<Filter, number>, [serials]);
  const rows = useMemo(
    () => serials.filter((s) => inFilter(s, filter) && matches(q, s.number, itemsById.get(s.itemId)?.sku, itemsById.get(s.itemId)?.name, s.customer)),
    [serials, filter, q, itemsById],
  );

  const columns = useMemo<Column<Serial>[]>(
    () => [
      { key: "number", header: "Serial", width: "150px", sortValue: (s) => s.number, render: (s) => <span className="font-mono text-[12.5px] font-medium text-text">{s.number}</span> },
      {
        key: "item",
        header: "Item",
        sortValue: (s) => itemsById.get(s.itemId)?.sku ?? "",
        render: (s) => {
          const item = itemsById.get(s.itemId);
          return item ? (
            <span className="block min-w-0">
              <span className="font-mono text-[12px] text-text">{item.sku}</span>
              <span className="block max-w-[280px] truncate text-text-secondary">{item.name}</span>
            </span>
          ) : (
            <span className="text-text-tertiary">Deleted item</span>
          );
        },
      },
      { key: "status", header: "Status", width: "130px", sortValue: (s) => s.status, render: (s) => <SerialStatusBadge status={s.status} /> },
      {
        key: "where",
        header: "Where",
        render: (s) => {
          if (s.status === "shipped") return <span className="text-text-secondary">{s.customer ?? "Customer"}</span>;
          if (s.status === "installed") return <span className="text-text-secondary">In {serialsById.get(s.parentSerialId ?? "")?.number ?? "another unit"}</span>;
          if (s.status === "planned" || s.status === "in_production") return <span className="text-text-secondary">{workOrders.find((w) => w.id === s.workOrderId)?.number ?? "Work order"}</span>;
          if (s.status === "in_stock") return <span className="text-text-secondary">{locationName(s.locationId)}</span>;
          return <span className="text-text-tertiary">—</span>;
        },
      },
      { key: "finished", header: "Finished", width: "130px", hideBelow: "md", sortValue: (s) => s.finishedAt ?? "", render: (s) => <span className="tabular text-text-secondary">{s.finishedAt ? formatDate(s.finishedAt) : "—"}</span> },
    ],
    [itemsById, serialsById, workOrders, locationName],
  );

  if (!enabled) {
    return (
      <Page title="Serial numbers">
        <Card padded={false}>
          <EmptyState icon={<Hash />} title="Serial numbers are not switched on" description="This feature is still in preview. It can be switched on under Settings → Labs where previews are available." action={<Button href="/settings#labs">Open Labs</Button>} />
        </Card>
      </Page>
    );
  }

  return (
    <Page title="Serial numbers" subtitle="Every unit made with its own number: where it is, what went into it and who has it">
      <Table
        rows={rows}
        columns={columns}
        rowKey={(s) => s.id}
        rowLabel={(s) => s.number}
        onRowClick={(s) => router.push(serialHref(s.id))}
        defaultSort={{ key: "number", dir: "desc" }}
        toolbar={
          <>
            <SearchField value={q} onChange={setQ} placeholder="Search serial, item or customer" className="w-full sm:w-72" />
            <Segmented<Filter> value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ ...f, count: counts[f.value] }))} />
          </>
        }
        emptyState={
          serials.length === 0 ? (
            <EmptyState icon={<Hash />} title="No serial numbers yet" description="Turn on serial numbers on an assembly (its Production tab), then release a work order for it." />
          ) : (
            <EmptyState title="Nothing matches" description="Try another search or status." />
          )
        }
      />
    </Page>
  );
}
