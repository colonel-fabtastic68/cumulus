"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { Download, Mail, MessageSquareText, Plus } from "lucide-react";
import type { Customer } from "@/lib/types";
import { useAgent } from "@/components/agent/AgentProvider";
import { Badge, Button, Page, QueryParamEffect, SearchField, Table, type Column } from "@/components/ui";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { customerHistory } from "@/lib/customers";
import { formatMoney, formatRelative } from "@/lib/format";
import { useCollection, useSettings } from "@/lib/store/provider";
import { CustomerDrawer, CustomerModal } from "@/components/customers";

export default function CustomersPage() {
  const customers = useCollection("customers");
  const orders = useCollection("orders");
  const rmas = useCollection("rmas");
  const quotes = useCollection("quotes");
  const { currency } = useSettings();
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

  const columns: Column<(typeof rows)[number]>[] = [
    { key: "name", header: "Customer", render: (r) => <span className="font-medium text-text">{r.c.name}</span>, sortValue: (r) => r.c.name },
    { key: "company", header: "Company", render: (r) => <span className="text-text-secondary">{r.c.company ?? "—"}</span>, sortValue: (r) => r.c.company ?? "" },
    { key: "email", header: "Email", render: (r) => <span className="text-text-secondary">{r.c.email ?? "—"}</span>, sortValue: (r) => r.c.email ?? "" },
    { key: "phone", header: "Phone", render: (r) => <span className="text-text-secondary">{r.c.phone ?? "—"}</span> },
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
