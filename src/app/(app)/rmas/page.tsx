"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, RotateCcw } from "lucide-react";
import type { Rma } from "@/lib/types";
import { useCollection, useItemsById } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { formatDate, formatNumber, formatRelative } from "@/lib/format";
import { matches, sum } from "@/lib/utils";
import { Button, EmptyState, Page, SearchField, Segmented, StatusBadge, Table, type Column } from "@/components/ui";
import { NewRmaModal, RmaDrawer, RmaStats } from "@/components/rmas";

type Filter = "open" | "resolved" | "all";

const isOpen = (r: Rma) => r.status === "open" || r.status === "inspecting";

export default function ReturnsPage() {
  const rmas = useCollection("rmas");
  const movements = useCollection("movements");
  const itemsById = useItemsById();
  const user = useCurrentUser();
  const { setPageContext } = useAgent();
  const writable = canWrite(user);

  const [filter, setFilter] = useState<Filter>("open");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const open = rmas.filter(isOpen).length;
    return { open, resolved: rmas.length - open, all: rmas.length };
  }, [rmas]);

  const rows = useMemo(
    () =>
      rmas.filter((r) => {
        if (filter === "open" && !isOpen(r)) return false;
        if (filter === "resolved" && isOpen(r)) return false;
        if (!query.trim()) return true;
        const skus = r.lines.map((l) => itemsById.get(l.itemId)?.sku).filter(Boolean) as string[];
        return matches(query, r.number, r.customer, r.reference, r.reason, r.status, ...skus);
      }),
    [rmas, filter, query, itemsById],
  );

  const selectedSkus = useMemo(() => {
    const rma = rmas.find((r) => r.id === selectedId);
    return rma ? (rma.lines.map((l) => itemsById.get(l.itemId)?.sku).filter(Boolean) as string[]) : undefined;
  }, [rmas, selectedId, itemsById]);

  useEffect(() => {
    setPageContext({ page: "Returns (RMAs)", selectedSkus });
  }, [setPageContext, selectedSkus]);

  const columns = useMemo<Column<Rma>[]>(
    () => [
      { key: "number", header: "Number", render: (r) => <span className="font-medium text-text">{r.number}</span>, sortValue: (r) => r.number, width: "110px" },
      { key: "customer", header: "Customer", render: (r) => <span className="block max-w-[220px] truncate">{r.customer}</span>, sortValue: (r) => r.customer },
      { key: "reference", header: "Reference", render: (r) => (r.reference ? <span className="font-mono text-[12px] text-text-secondary">{r.reference}</span> : <span className="text-text-tertiary">—</span>), sortValue: (r) => r.reference ?? "", hideBelow: "md" },
      {
        key: "reason",
        header: "Reason",
        render: (r) => (
          <span className="block max-w-[260px] truncate text-text-secondary" title={r.reason}>
            {r.reason}
          </span>
        ),
        hideBelow: "lg",
      },
      { key: "lines", header: "Lines", render: (r) => formatNumber(sum(r.lines.map((l) => l.qty))), sortValue: (r) => sum(r.lines.map((l) => l.qty)), align: "right", width: "80px" },
      { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} />, sortValue: (r) => r.status, width: "120px" },
      { key: "created", header: "Created", render: (r) => <span className="text-text-secondary">{formatRelative(r.createdAt)}</span>, sortValue: (r) => r.createdAt, align: "right", width: "110px" },
      { key: "resolved", header: "Resolved", render: (r) => <span className="text-text-secondary">{formatDate(r.resolvedAt)}</span>, sortValue: (r) => r.resolvedAt ?? "", align: "right", width: "120px", hideBelow: "md" },
    ],
    [],
  );

  const newRmaButton = writable ? (
    <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
      New RMA
    </Button>
  ) : undefined;

  const emptyState =
    rmas.length === 0 ? (
      <EmptyState icon={<RotateCcw />} title="No returns yet" description="RMA tickets track goods coming back from customers and whether they get restocked, refunded or scrapped." action={newRmaButton} />
    ) : (
      <EmptyState icon={<RotateCcw />} title={filter === "open" && !query ? "No open returns" : "No matching returns"} description={filter === "open" && !query ? "Everything that came back has been dealt with." : "Try a different filter or search term."} />
    );

  return (
    <Page title="Returns" subtitle="RMA tickets for goods coming back" primaryAction={newRmaButton}>
      <Suspense fallback={null}>
        <HighlightParam onHighlight={setSelectedId} />
      </Suspense>
      <div className="flex flex-col gap-4">
        <RmaStats rmas={rmas} movements={movements} />
        <Table
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          onRowClick={(r) => setSelectedId(r.id)}
          defaultSort={{ key: "created", dir: "desc" }}
          emptyState={emptyState}
          footer={`${rows.length} of ${rmas.length} ${rmas.length === 1 ? "return" : "returns"}`}
          toolbar={
            <div className="flex w-full flex-wrap items-center gap-2">
              <Segmented<Filter>
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "open", label: "Open", count: counts.open },
                  { value: "resolved", label: "Resolved", count: counts.resolved },
                  { value: "all", label: "All", count: counts.all },
                ]}
              />
              <SearchField value={query} onChange={setQuery} placeholder="Search number, customer, reference, SKU" className="w-full sm:ml-auto sm:w-72" />
            </div>
          }
        />
      </div>

      <NewRmaModal open={creating} onClose={() => setCreating(false)} onCreated={(rma) => setSelectedId(rma.id)} />
      <RmaDrawer rmaId={selectedId} onClose={() => setSelectedId(null)} />
    </Page>
  );
}

/** Reads ?highlight=<rmaId> once, opens that ticket, then drops the param from the URL. Rendered inside Suspense. */
function HighlightParam({ onHighlight }: { onHighlight: (id: string) => void }) {
  const params = useSearchParams();
  const id = params.get("highlight");
  useEffect(() => {
    if (!id) return;
    onHighlight(id);
    const url = new URL(window.location.href);
    url.searchParams.delete("highlight");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [id, onHighlight]);
  return null;
}
