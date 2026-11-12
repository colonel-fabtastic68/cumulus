"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { Download, FileDown, Mail, MessageSquareText, Plus } from "lucide-react";
import type { Customer } from "@/lib/types";
import { useAgent } from "@/components/agent/AgentProvider";
import { Badge, Button, Page, QueryParamEffect, SearchField, Table, useToast, type Column } from "@/components/ui";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { customerHistory, saveCustomer } from "@/lib/customers";
import { customFieldsFor, priceGroupLabel, priceGroups } from "@/lib/catalog";
import { formatMoney, formatRelative, pluralize } from "@/lib/format";
import { csvFilename, downloadCsv } from "@/components/reports/csv";
import { useFeature } from "@/lib/useFeature";
import { useCollection, useSettings, useStore } from "@/lib/store/provider";
import { CustomerDrawer, CustomerModal } from "@/components/customers";

export default function CustomersPage() {
  const customers = useCollection("customers");
  const orders = useCollection("orders");
  const rmas = useCollection("rmas");
  const quotes = useCollection("quotes");
  const settings = useSettings();
  const { currency } = settings;
  const store = useStore();
  const groups = priceGroups(settings);
  const user = useCurrentUser();
  const writable = canWrite(user);
  const { setPageContext } = useAgent();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setPageContext({ page: "Customers" });
  }, [setPageContext]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return customers
      .filter((c) => !needle || [c.name, c.email, c.phone, c.company, ...(c.tags ?? [])].some((v) => v?.toLowerCase().includes(needle)))
      .map((c) => ({ c, h: customerHistory(c, { orders, rmas, quotes }) }));
  }, [customers, orders, rmas, quotes, q]);
  const selected = useMemo(() => customers.find((c) => c.id === selectedId) ?? null, [customers, selectedId]);
  const canExport = useFeature("customerExport");
  const toast = useToast();

  /** The customers on screen (after the search), one row each, with what they have bought. */
  const exportCsv = () => {
    const fields = customFieldsFor(settings, "customers");
    downloadCsv(
      csvFilename(q.trim() ? "customers-filtered" : "customers"),
      ["Name", "Company", "Email", "Phone", "Street", "Street 2", "City", "State", "Postal code", "Country", "Price group", "Discount %", "Tax exempt", "Do not contact", "Tags", "Orders", "Revenue", "Last order", "Notes", ...fields.map((f) => f.label)],
      [...rows]
        .sort((a, b) => a.c.name.localeCompare(b.c.name))
        .map(({ c, h }) => [
          c.name,
          c.company,
          c.email,
          c.phone,
          c.address?.street1,
          c.address?.street2,
          c.address?.city,
          c.address?.state,
          c.address?.zip,
          c.address?.country,
          groups.find((g) => g.id === c.priceGroupId)?.name,
          c.discountPct,
          c.taxExempt ? "yes" : "",
          c.doNotContact ? "yes" : "",
          c.tags?.join(", "),
          h.orders.length,
          h.revenue,
          h.lastOrderAt?.slice(0, 10),
          c.notes,
          ...fields.map((f) => c.attributes?.[f.key]),
        ]),
    );
    toast(`Exported ${pluralize(rows.length, "customer")} to CSV`, "success");
  };

  const columns: Column<(typeof rows)[number]>[] = [
    { key: "name", header: "Customer", render: (r) => <span className="font-medium text-text">{r.c.name}</span>, sortValue: (r) => r.c.name },
    { key: "company", header: "Company", render: (r) => <span className="text-text-secondary">{r.c.company ?? "—"}</span>, sortValue: (r) => r.c.company ?? "" },
    { key: "email", header: "Email", render: (r) => <span className="text-text-secondary">{r.c.email ?? "—"}</span>, sortValue: (r) => r.c.email ?? "" },
    { key: "phone", header: "Phone", render: (r) => <span className="text-text-secondary">{r.c.phone ?? "—"}</span> },
    {
      key: "priceGroup",
      header: "Price group",
      sortValue: (r) => groups.find((g) => g.id === r.c.priceGroupId)?.name ?? "",
      render: (r) =>
        writable ? (
          <span onClick={(e) => e.stopPropagation()}>
            <select
              aria-label={`Price group for ${r.c.name}`}
              value={r.c.priceGroupId ?? ""}
              onChange={(e) => void saveCustomer(store, user, { ...r.c, priceGroupId: e.target.value || undefined }, r.c.id)}
              className={`h-7 max-w-[200px] rounded-[var(--radius-sm)] border border-border bg-surface px-2 text-[12.5px] ${r.c.priceGroupId ? "text-text" : "text-critical/70"}`}
            >
              <option value="">Not set</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {priceGroupLabel(g, currency)}
                </option>
              ))}
            </select>
          </span>
        ) : (
          <span className="text-text-secondary">{groups.find((g) => g.id === r.c.priceGroupId)?.name ?? "—"}</span>
        ),
    },
    { key: "orders", header: "Orders", align: "right", render: (r) => r.h.orders.length, sortValue: (r) => r.h.orders.length },
    { key: "revenue", header: "Revenue", align: "right", render: (r) => formatMoney(r.h.revenue, currency), sortValue: (r) => r.h.revenue },
    { key: "last", header: "Last order", render: (r) => <span className="text-text-secondary">{r.h.lastOrderAt ? formatRelative(r.h.lastOrderAt) : "—"}</span>, sortValue: (r) => r.h.lastOrderAt ?? "" },
    { key: "tags", header: "Tags", render: (r) => (r.c.tags?.length ? <span className="flex flex-wrap gap-1">{r.c.tags.map((t) => <Badge key={t}>{t}</Badge>)}</span> : null) },
  ];

  return (
    <Page
      title="Customers"
      subtitle="Who buys from you, with every order, return and quote on one record"
      primaryAction={
        writable ? (
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
            New customer
          </Button>
        ) : undefined
      }
      secondaryActions={
        <>
          <Button icon={<MessageSquareText />} disabled title="Mass texts are coming soon">
            Text
          </Button>
          <Button icon={<Mail />} disabled title="Mass email is coming soon">
            Email
          </Button>
          <Badge tone="attention">Coming soon</Badge>
          <Button icon={<Download />} href="/import#customers">
            Import
          </Button>
          {canExport && (
            <Button icon={<FileDown />} onClick={exportCsv} disabled={rows.length === 0}>
              Export
            </Button>
          )}
        </>
      }
    >
      <Suspense fallback={null}>
        <QueryParamEffect param="highlight" onValue={setSelectedId} />
      </Suspense>
      <Table
        rows={rows}
        columns={columns}
        rowKey={(r) => r.c.id}
        onRowClick={(r) => setSelectedId(r.c.id)}
        defaultSort={{ key: "name", dir: "asc" }}
        toolbar={<SearchField value={q} onChange={setQ} placeholder="Search customers" />}
        emptyState={customers.length === 0 ? "No customers yet. Add one, import a CSV, or create an order: the customer on it is recorded here." : "No customers match."}
      />
      <CustomerModal open={creating} onClose={() => setCreating(false)} onSaved={(c: Customer) => setSelectedId(c.id)} />
      <CustomerDrawer customer={selected} onClose={() => setSelectedId(null)} />
    </Page>
  );
}
