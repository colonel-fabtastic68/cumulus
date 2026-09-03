"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Truck } from "lucide-react";
import type { Supplier } from "@/lib/types";
import { useCollection, useItems, useSettings } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { formatMoney, formatNumber } from "@/lib/format";
import { matches } from "@/lib/utils";
import { Badge, Button, EmptyState, Page, SearchField, Table, type Column } from "@/components/ui";
import { NewSupplierModal, SupplierDrawer, formatLeadTime, statsFor, useSupplierStats, websiteLabel } from "@/components/suppliers";

export default function SuppliersPage() {
  const suppliers = useCollection("suppliers");
  const items = useItems();
  const settings = useSettings();
  const user = useCurrentUser();
  const { setPageContext } = useAgent();
  const writable = canWrite(user);

  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const statsById = useSupplierStats(items);

  const rows = useMemo(() => suppliers.filter((s) => matches(query, s.name, s.email, s.phone, s.website, s.terms, s.notes)), [suppliers, query]);

  const selectedSkus = useMemo(() => (selectedId ? statsFor(statsById, selectedId).items.map((i) => i.sku) : undefined), [statsById, selectedId]);

  useEffect(() => {
    setPageContext({ page: "Suppliers", selectedSkus });
  }, [setPageContext, selectedSkus]);

  const columns = useMemo<Column<Supplier>[]>(
    () => [
      {
        key: "name",
        header: "Name",
        render: (s) => (
          <div className="min-w-0">
            <div className="truncate font-medium text-text">{s.name}</div>
            {s.website && <div className="truncate text-[12px] text-text-tertiary">{websiteLabel(s.website)}</div>}
          </div>
        ),
        sortValue: (s) => s.name,
      },
      {
        key: "contact",
        header: "Contact",
        render: (s) =>
          s.email || s.phone ? (
            <div className="min-w-0 text-[12.5px]">
              {s.email && <div className="truncate text-text-secondary">{s.email}</div>}
              {s.phone && <div className="truncate text-text-tertiary tabular">{s.phone}</div>}
            </div>
          ) : (
            <span className="text-text-tertiary">—</span>
          ),
        sortValue: (s) => s.email ?? s.phone ?? "",
        hideBelow: "sm",
      },
      { key: "leadTime", header: "Lead time", render: (s) => <span className={s.leadTimeDays === undefined ? "text-text-tertiary" : undefined}>{formatLeadTime(s.leadTimeDays)}</span>, sortValue: (s) => s.leadTimeDays ?? null, align: "right", width: "100px" },
      { key: "terms", header: "Terms", render: (s) => (s.terms ? <span className="text-text-secondary">{s.terms}</span> : <span className="text-text-tertiary">—</span>), sortValue: (s) => s.terms ?? "", hideBelow: "md", width: "110px" },
      { key: "items", header: "Items supplied", render: (s) => formatNumber(statsFor(statsById, s.id).items.length), sortValue: (s) => statsFor(statsById, s.id).items.length, align: "right", width: "120px" },
      {
        key: "low",
        header: "Below minimum",
        render: (s) => {
          const n = statsFor(statsById, s.id).lowItems.length;
          return n > 0 ? <Badge tone="warning">{formatNumber(n)}</Badge> : <span className="text-text-tertiary">0</span>;
        },
        sortValue: (s) => statsFor(statsById, s.id).lowItems.length,
        align: "right",
        width: "130px",
      },
      { key: "value", header: "Stock value", render: (s) => formatMoney(statsFor(statsById, s.id).value, settings.currency), sortValue: (s) => statsFor(statsById, s.id).value, align: "right", width: "120px", hideBelow: "md" },
    ],
    [statsById, settings.currency],
  );

  const newSupplierButton = writable ? (
    <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
      New supplier
    </Button>
  ) : undefined;

  const emptyState =
    suppliers.length === 0 ? (
      <EmptyState
        icon={<Truck />}
        title="No suppliers yet"
        description={writable ? "Add who you buy from, then assign them on items to track lead times and see what needs reordering." : "Suppliers added by your team will show up here."}
        action={newSupplierButton}
      />
    ) : (
      <EmptyState icon={<Truck />} title="No matching suppliers" description="Try a different search term." />
    );

  return (
    <Page title="Suppliers" subtitle="Who you buy from and what they supply" primaryAction={newSupplierButton}>
      <Suspense fallback={null}>
        <HighlightParam onHighlight={setSelectedId} />
      </Suspense>
      <Table
        rows={rows}
        columns={columns}
        rowKey={(s) => s.id}
        onRowClick={(s) => setSelectedId(s.id)}
        defaultSort={{ key: "name", dir: "asc" }}
        emptyState={emptyState}
        footer={`${rows.length} of ${suppliers.length} ${suppliers.length === 1 ? "supplier" : "suppliers"}`}
        toolbar={
          <div className="flex w-full flex-wrap items-center gap-2">
            <SearchField value={query} onChange={setQuery} placeholder="Search name, email, terms" className="w-full sm:w-72" />
            <span className="hidden text-[12.5px] text-text-tertiary sm:ml-auto sm:inline">Click a supplier to edit it or draft a reorder</span>
          </div>
        }
      />

      <NewSupplierModal open={creating} onClose={() => setCreating(false)} onCreated={(s) => setSelectedId(s.id)} />
      <SupplierDrawer supplierId={selectedId} onClose={() => setSelectedId(null)} />
    </Page>
  );
}

/** Reads ?highlight=<supplierId> once, opens that supplier, then drops the param from the URL. Rendered inside Suspense. */
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
