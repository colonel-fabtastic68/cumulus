"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarRange, ClipboardList, Factory, Plus } from "lucide-react";
import type { WorkOrder } from "@/lib/types";
import { committedValue, productionSchedule, workOrderIsLate, workOrderIsOpen, workOrderNeeds, workOrderRemaining } from "@/lib/workOrders";
import { useCollection, useItems, useItemsById, useSettings } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { useFeature } from "@/lib/useFeature";
import { formatDate, formatMoney, formatNumber, pluralize } from "@/lib/format";
import { matches } from "@/lib/utils";
import { Badge, Button, Card, EmptyState, Page, QueryParamEffect, SearchField, Segmented, Stat, Table, type Column } from "@/components/ui";
import { DueCell, NewWorkOrderModal, ProgressCell, WorkOrderDetailModal, WorkOrderStatusBadge } from "@/components/production";

type Filter = "open" | "planned" | "released" | "in_progress" | "completed" | "all";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "planned", label: "Planned" },
  { value: "released", label: "Released" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Done" },
  { value: "all", label: "All" },
];

export default function WorkOrdersPage() {
  const enabled = useFeature("workOrders");
  const workOrders = useCollection("workOrders");
  const items = useItems();
  const itemsById = useItemsById();
  const { currency } = useSettings();
  const user = useCurrentUser();
  const writable = canWrite(user);
  const { setPageContext } = useAgent();
  const [filter, setFilter] = useState<Filter>("open");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setPageContext({ page: "Work orders" });
  }, [setPageContext]);

  const selected = useMemo(() => workOrders.find((w) => w.id === selectedId) ?? null, [workOrders, selectedId]);
  const open = useMemo(() => workOrders.filter(workOrderIsOpen), [workOrders]);
  const inWork = useMemo(() => workOrders.filter((w) => w.status === "released" || w.status === "in_progress"), [workOrders]);
  const late = useMemo(() => open.filter((w) => workOrderIsLate(w)), [open]);
  const committed = useMemo(() => committedValue(workOrders, items), [workOrders, items]);
  const shortRuns = useMemo(() => new Set(open.filter((w) => workOrderNeeds(w, items).some((n) => n.shortage > 0)).map((w) => w.id)), [open, items]);
  const schedule = useMemo(() => productionSchedule(workOrders), [workOrders]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { open: open.length, planned: 0, released: 0, in_progress: 0, completed: 0, all: workOrders.length };
    for (const w of workOrders) if (w.status !== "cancelled") c[w.status]++;
    return c;
  }, [workOrders, open.length]);

  const rows = useMemo(() => {
    let list = filter === "all" ? workOrders : filter === "open" ? open : workOrders.filter((w) => w.status === filter);
    if (q.trim()) list = list.filter((w) => matches(q, w.number, itemsById.get(w.assemblyId)?.sku, itemsById.get(w.assemblyId)?.name, w.note));
    return list;
  }, [workOrders, open, filter, q, itemsById]);

  const columns = useMemo<Column<WorkOrder>[]>(
    () => [
      { key: "number", header: "Number", width: "110px", sortValue: (w) => w.number, render: (w) => <span className="font-medium text-text">{w.number}</span> },
      {
        key: "assembly",
        header: "Assembly",
        sortValue: (w) => itemsById.get(w.assemblyId)?.sku ?? "",
        render: (w) => {
          const asm = itemsById.get(w.assemblyId);
          return asm ? (
            <span className="block min-w-0">
              <Link href={`/inventory/${asm.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-[12px] font-medium text-accent hover:underline">
                {asm.sku}
              </Link>
              <span className="block max-w-[280px] truncate text-text-secondary" title={asm.name}>
                {asm.name}
              </span>
            </span>
          ) : (
            <span className="text-text-tertiary">Deleted assembly</span>
          );
        },
      },
      { key: "progress", header: "Built", width: "150px", sortValue: (w) => (w.qty ? w.qtyCompleted / w.qty : 0), render: (w) => <ProgressCell wo={w} /> },
      { key: "due", header: "Due", width: "150px", sortValue: (w) => w.dueOn ?? "9999", render: (w) => <DueCell wo={w} /> },
      {
        key: "parts",
        header: "Parts",
        width: "120px",
        hideBelow: "md",
        render: (w) => (!workOrderIsOpen(w) ? <span className="text-text-tertiary">—</span> : shortRuns.has(w.id) ? <Badge tone="warning">Short</Badge> : <Badge tone="success">Ready</Badge>),
        sortValue: (w) => (shortRuns.has(w.id) ? 0 : 1),
      },
      { key: "priority", header: "Priority", width: "100px", hideBelow: "lg", sortValue: (w) => ({ high: 0, normal: 1, low: 2 })[w.priority ?? "normal"], render: (w) => (w.priority === "high" ? <Badge tone="warning">High</Badge> : <span className="text-text-secondary">{w.priority === "low" ? "Low" : "Normal"}</span>) },
      { key: "status", header: "Status", width: "120px", sortValue: (w) => w.status, render: (w) => <WorkOrderStatusBadge status={w.status} /> },
    ],
    [itemsById, shortRuns],
  );

  if (!enabled) {
    return (
      <Page title="Work orders">
        <Card padded={false}>
          <EmptyState icon={<Factory />} title="Work orders are not switched on" description="This feature is still in preview. It can be switched on under Settings → Labs where previews are available." action={<Button href="/settings#labs">Open Labs</Button>} />
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title="Work orders"
      subtitle="Production runs: what is planned, what is on the floor, and whether the parts are there"
      primaryAction={
        writable ? (
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
            New work order
          </Button>
        ) : undefined
      }
    >
      <Suspense fallback={null}>
        <QueryParamEffect param="highlight" onValue={setSelectedId} />
      </Suspense>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
          <Stat label="Open runs" value={formatNumber(open.length)} hint={`${formatNumber(open.reduce((a, w) => a + workOrderRemaining(w), 0))} units still to build`} icon={<ClipboardList />} />
          <Stat label="On the floor" value={formatNumber(inWork.length)} hint="Released or in progress" icon={<Factory />} />
          <Stat label="Parts committed" value={formatMoney(committed, currency)} hint="On hand, spoken for by released runs" />
          <Stat label="Late" value={formatNumber(late.length)} hint={late.length ? "Past the due date" : "Nothing is past its due date"} tone={late.length ? "warning" : "default"} icon={<AlertTriangle />} />
        </div>

        {schedule.length > 0 && (
          <Card padded={false}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
              <CalendarRange className="h-4 w-4 text-icon" />
              <h3 className="text-[13.5px] font-semibold text-text">Schedule</h3>
              <span className="text-[12.5px] text-text-secondary">Open runs by the week they are due</span>
            </div>
            <div className="flex gap-3 overflow-x-auto p-3">
              {schedule.map((week) => (
                <div key={week.week || "undated"} className="flex w-56 shrink-0 flex-col gap-1.5 rounded-[var(--radius)] border border-border bg-surface-subdued p-2">
                  <div className="flex items-baseline justify-between gap-2 px-1">
                    <span className="text-[12.5px] font-semibold text-text">{week.week ? `Week of ${formatDate(week.week).replace(/, \d{4}$/, "")}` : "No date"}</span>
                    <span className="text-[12px] tabular text-text-tertiary">{pluralize(week.units, "unit")}</span>
                  </div>
                  {week.workOrders.map((w) => {
                    const asm = itemsById.get(w.assemblyId);
                    return (
                      <button key={w.id} type="button" onClick={() => setSelectedId(w.id)} className="flex flex-col gap-0.5 rounded-[var(--radius-sm)] border border-border bg-surface px-2 py-1.5 text-left hover:border-border-strong">
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[12px] font-medium text-text">{w.number}</span>
                          {workOrderIsLate(w) ? <Badge tone="warning">Late</Badge> : shortRuns.has(w.id) ? <Badge tone="attention">Short</Badge> : <WorkOrderStatusBadge status={w.status} />}
                        </span>
                        <span className="truncate text-[12.5px] text-text-secondary" title={asm?.name}>
                          {workOrderRemaining(w)} × {asm?.sku ?? "?"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </Card>
        )}

        <Table
          rows={rows}
          columns={columns}
          rowKey={(w) => w.id}
          rowLabel={(w) => w.number}
          onRowClick={(w) => setSelectedId(w.id)}
          defaultSort={{ key: "due", dir: "asc" }}
          pageSize={25}
          toolbar={
            <div className="flex w-full flex-wrap items-center gap-2">
              <div className="min-w-0 max-w-full overflow-x-auto">
                <Segmented value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.value, label: f.label, count: counts[f.value] }))} />
              </div>
              <SearchField value={q} onChange={setQ} placeholder="Search number or assembly" className="w-full sm:ml-auto sm:w-72" />
            </div>
          }
          emptyState={
            <EmptyState
              icon={<Factory />}
              title={workOrders.length === 0 ? "No work orders yet" : "No work orders match"}
              description={workOrders.length === 0 ? "A work order plans a build before it happens: how many, by when, and whether the parts are on the shelf. Completing it books the build." : "Try another status or search."}
              action={
                workOrders.length === 0 && writable ? (
                  <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setCreating(true)}>
                    New work order
                  </Button>
                ) : undefined
              }
            />
          }
          footer={`${rows.length} of ${pluralize(workOrders.length, "work order")}`}
        />
      </div>

      <NewWorkOrderModal open={creating} onClose={() => setCreating(false)} onCreated={(w) => setSelectedId(w.id)} />
      <WorkOrderDetailModal workOrder={selected} onClose={() => setSelectedId(null)} canWrite={writable} />
    </Page>
  );
}
