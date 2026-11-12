"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { BriefcaseBusiness, Plus } from "lucide-react";
import type { Job } from "@/lib/types";
import { jobCost, jobIsOpen } from "@/lib/jobs";
import { useCollection, useSettings } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { useFeature } from "@/lib/useFeature";
import { formatDate, formatMoney, formatNumber, pluralize, toDateInput } from "@/lib/format";
import { matches } from "@/lib/utils";
import { Badge, Button, Card, EmptyState, Page, QueryParamEffect, SearchField, Segmented, Stat, Table, type Column } from "@/components/ui";
import { JobDrawer, JobModal, JobStatusBadge } from "@/components/jobs";

type Filter = "open" | "completed" | "all";

export default function JobsPage() {
  const enabled = useFeature("jobs");
  const jobs = useCollection("jobs");
  const orders = useCollection("orders");
  const purchaseOrders = useCollection("purchaseOrders");
  const workOrders = useCollection("workOrders");
  const builds = useCollection("builds");
  const movements = useCollection("movements");
  const { currency } = useSettings();
  const user = useCurrentUser();
  const writable = canWrite(user);
  const { setPageContext } = useAgent();
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Job | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [today] = useState(() => toDateInput());

  useEffect(() => {
    setPageContext({ page: "Jobs" });
  }, [setPageContext]);

  const all = useMemo(() => {
    const src = { orders, purchaseOrders, workOrders, builds, movements };
    return jobs.map((job) => ({ job, cost: jobCost(job, src) }));
  }, [jobs, orders, purchaseOrders, workOrders, builds, movements]);
  const selected = useMemo(() => jobs.find((j) => j.id === selectedId) ?? null, [jobs, selectedId]);
  const open = useMemo(() => all.filter((r) => jobIsOpen(r.job)), [all]);
  const counts: Record<Filter, number> = { open: open.length, completed: all.filter((r) => r.job.status === "completed").length, all: all.length };
  const rows = useMemo(() => {
    const list = filter === "all" ? all : filter === "open" ? open : all.filter((r) => r.job.status === "completed");
    return q.trim() ? list.filter((r) => matches(q, r.job.number, r.job.name, r.job.customer, ...(r.job.crew ?? []).map((c) => c.name))) : list;
  }, [all, open, filter, q]);

  const columns = useMemo<Column<(typeof all)[number]>[]>(
    () => [
      { key: "number", header: "Number", width: "110px", sortValue: (r) => r.job.number, render: (r) => <span className="font-medium text-text">{r.job.number}</span> },
      {
        key: "name",
        header: "Job",
        sortValue: (r) => r.job.name,
        render: (r) => (
          <span className="block min-w-0">
            <span className="block max-w-[320px] truncate font-medium text-text" title={r.job.name}>
              {r.job.name}
            </span>
            {r.job.customer && <span className="block max-w-[320px] truncate text-text-secondary">{r.job.customer}</span>}
          </span>
        ),
      },
      {
        key: "due",
        header: "Due",
        width: "150px",
        sortValue: (r) => r.job.dueOn ?? "9999",
        render: (r) =>
          r.job.dueOn ? (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <span className="whitespace-nowrap text-text-secondary">{formatDate(r.job.dueOn)}</span>
              {jobIsOpen(r.job) && r.job.dueOn < today && <Badge tone="warning">Late</Badge>}
            </span>
          ) : (
            <span className="text-text-tertiary">—</span>
          ),
      },
      { key: "crew", header: "People", width: "90px", align: "right", hideBelow: "md", sortValue: (r) => r.job.crew?.length ?? 0, render: (r) => <span className="text-text-secondary">{formatNumber(r.job.crew?.length ?? 0)}</span> },
      { key: "revenue", header: "Revenue", width: "120px", align: "right", sortValue: (r) => r.cost.revenue, render: (r) => formatMoney(r.cost.revenue, currency) },
      {
        key: "cost",
        header: "Cost",
        width: "140px",
        align: "right",
        hideBelow: "sm",
        sortValue: (r) => r.cost.cost,
        render: (r) => (
          <span className="inline-flex items-center gap-1.5">
            {r.cost.budgetUsedPct !== undefined && r.cost.budgetUsedPct > 100 && <Badge tone="critical">Over budget</Badge>}
            {formatMoney(r.cost.cost, currency)}
          </span>
        ),
      },
      { key: "status", header: "Status", width: "120px", sortValue: (r) => r.job.status, render: (r) => <JobStatusBadge status={r.job.status} /> },
    ],
    [currency, today],
  );

  if (!enabled) {
    return (
      <Page title="Jobs">
        <Card padded={false}>
          <EmptyState icon={<BriefcaseBusiness />} title="Jobs are not switched on" description="This feature is still in preview. It can be switched on under Settings → Labs where previews are available." action={<Button href="/settings#labs">Open Labs</Button>} />
        </Card>
      </Page>
    );
  }

  const openRevenue = open.reduce((a, r) => a + r.cost.revenue, 0);
  const openCost = open.reduce((a, r) => a + r.cost.cost, 0);

  return (
    <Page
      title="Jobs"
      subtitle="Orders, purchases and production grouped by the work they belong to, with the people on it"
      primaryAction={
        writable ? (
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
            New job
          </Button>
        ) : undefined
      }
    >
      <Suspense fallback={null}>
        <QueryParamEffect param="highlight" onValue={setSelectedId} />
      </Suspense>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3">
          <Stat label="Open jobs" value={formatNumber(open.length)} hint={`${formatNumber(open.filter((r) => r.job.dueOn && r.job.dueOn < today).length)} past due`} icon={<BriefcaseBusiness />} />
          <Stat label="Revenue on open jobs" value={formatMoney(openRevenue, currency)} hint="Sales orders filed under them" />
          <Stat label="Cost on open jobs" value={formatMoney(openCost, currency)} hint="Purchases plus materials built in" />
        </div>
        <Table
          rows={rows}
          columns={columns}
          rowKey={(r) => r.job.id}
          rowLabel={(r) => r.job.number}
          onRowClick={(r) => setSelectedId(r.job.id)}
          defaultSort={{ key: "due", dir: "asc" }}
          pageSize={25}
          toolbar={
            <div className="flex w-full flex-wrap items-center gap-2">
              <Segmented value={filter} onChange={setFilter} options={[{ value: "open", label: "Open", count: counts.open }, { value: "completed", label: "Completed", count: counts.completed }, { value: "all", label: "All", count: counts.all }]} />
              <SearchField value={q} onChange={setQ} placeholder="Search job, customer or person" className="w-full sm:ml-auto sm:w-72" />
            </div>
          }
          emptyState={
            <EmptyState
              icon={<BriefcaseBusiness />}
              title={jobs.length === 0 ? "No jobs yet" : "No jobs match"}
              description={jobs.length === 0 ? "Open a job for an install, a build or a project. File its sales orders, purchases and work orders under it to see what it has brought in and cost." : "Try another filter or search."}
              action={
                jobs.length === 0 && writable ? (
                  <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setCreating(true)}>
                    New job
                  </Button>
                ) : undefined
              }
            />
          }
          footer={`${rows.length} of ${pluralize(jobs.length, "job")}`}
        />
      </div>
      <JobModal open={creating || !!editing} job={editing} onClose={() => (setCreating(false), setEditing(null))} onSaved={(j) => setSelectedId(j.id)} />
      <JobDrawer job={selected} onClose={() => setSelectedId(null)} onEdit={setEditing} canWrite={writable} />
    </Page>
  );
}
