"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Pencil, X } from "lucide-react";
import type { Job, JobStatus } from "@/lib/types";
import { JOB_STATUS_LABEL, assignToJob, jobCost, jobDocuments, updateJob, type JobDocument } from "@/lib/jobs";
import { poIsOpen, poTotal } from "@/lib/purchaseOrders";
import { isOrderOpen } from "@/lib/inventory";
import { workOrderIsOpen } from "@/lib/workOrders";
import { useCollection, useItemsById, useSettings, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { formatDate, formatMoney, pluralize } from "@/lib/format";
import { cn, round, sum } from "@/lib/utils";
import { Badge, Button, Drawer, Select, useToast, type BadgeTone } from "@/components/ui";
import { PoStatusBadge } from "@/components/purchasing";
import { WorkOrderStatusBadge } from "@/components/production";
import { StatusBadge } from "@/components/ui";

const TONE: Record<JobStatus, BadgeTone> = { open: "info", on_hold: "attention", completed: "success", cancelled: "default" };

export function JobStatusBadge({ status }: { status: JobStatus }) {
  return <Badge tone={TONE[status]}>{JOB_STATUS_LABEL[status]}</Badge>;
}

function Money({ label, value, tone }: { label: string; value: string; tone?: "critical" | "success" }) {
  return (
    <div>
      <div className="text-[12px] text-text-tertiary">{label}</div>
      <div className={cn("text-[15px] font-semibold tabular", tone === "critical" ? "text-critical" : tone === "success" ? "text-success" : "text-text")}>{value}</div>
    </div>
  );
}

function Block({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-text">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A job's record: who is on it, what is filed under it, and what it has brought in and cost. */
export function JobDrawer({ job, onClose, onEdit, canWrite }: { job: Job | null; onClose: () => void; onEdit: (job: Job) => void; canWrite: boolean }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const orders = useCollection("orders");
  const purchaseOrders = useCollection("purchaseOrders");
  const workOrders = useCollection("workOrders");
  const builds = useCollection("builds");
  const movements = useCollection("movements");
  const itemsById = useItemsById();
  const { currency } = useSettings();
  const [busy, setBusy] = useState(false);

  const ledger = useMemo(() => ({ orders, purchaseOrders, workOrders, builds }), [orders, purchaseOrders, workOrders, builds]);
  const docs = useMemo(() => (job ? jobDocuments(job.id, ledger) : null), [job, ledger]);
  const cost = useMemo(() => (job ? jobCost(job, { ...ledger, movements }) : null), [job, ledger, movements]);
  if (!job || !docs || !cost) return null;

  const setStatus = async (status: JobStatus) => {
    setBusy(true);
    try {
      await updateJob(store, user, job.id, { status });
      toast(`${job.number} is ${JOB_STATUS_LABEL[status].toLowerCase()}`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(false);
    }
  };

  const link = async (collection: JobDocument, id: string, to: string | null) => {
    try {
      await assignToJob(store, collection, id, to);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    }
  };

  /** A select of documents not on any job yet, to file one under this job. */
  const adder = (collection: JobDocument, label: string, options: Array<{ value: string; label: string }>) =>
    canWrite && options.length > 0 ? <Select aria-label={label} value="" onChange={(e) => e.target.value && void link(collection, e.target.value, job.id)} placeholder={label} options={options} containerClassName="w-56" className="text-text" /> : null;

  const row = (key: string, href: string, number: string, detail: ReactNode, badge: ReactNode, amount: string | null, onRemove: () => void) => (
    <li key={key} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
      <Link href={href} className="shrink-0 font-mono font-medium text-accent hover:underline">
        {number}
      </Link>
      <span className="min-w-0 flex-1 truncate text-text-secondary">{detail}</span>
      {badge}
      {amount && <span className="shrink-0 tabular text-text">{amount}</span>}
      {canWrite && (
        <button type="button" onClick={onRemove} aria-label={`Take ${number} off this job`} title="Take off this job" className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-tertiary hover:bg-surface-hover hover:text-text">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
  const list = (rows: ReactNode[], empty: string) => (rows.length ? <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">{rows}</ul> : <p className="rounded-[var(--radius)] border border-dashed border-border px-3 py-3 text-[12.5px] text-text-tertiary">{empty}</p>);

  const used = cost.budgetUsedPct;
  return (
    <Drawer
      open
      onClose={onClose}
      width={560}
      title={
        <span className="inline-flex items-center gap-2">
          <span className="font-mono">{job.number}</span>
          <JobStatusBadge status={job.status} />
        </span>
      }
      subtitle={[job.name, job.customer].filter(Boolean).join(" · ")}
      headerActions={
        canWrite ? (
          <Button size="sm" variant="plain" icon={<Pencil />} onClick={() => onEdit(job)}>
            Edit
          </Button>
        ) : undefined
      }
      footer={
        canWrite ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Select aria-label="Job status" value={job.status} onChange={(e) => void setStatus(e.target.value as JobStatus)} disabled={busy} options={(Object.keys(JOB_STATUS_LABEL) as JobStatus[]).map((s) => ({ value: s, label: JOB_STATUS_LABEL[s] }))} containerClassName="w-40" />
            <Button onClick={onClose}>Close</Button>
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <div className="rounded-[var(--radius)] border border-border p-3">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Money label="Revenue" value={formatMoney(cost.revenue, currency)} />
            <Money label="Purchases" value={formatMoney(cost.purchases, currency)} />
            <Money label="Materials built in" value={formatMoney(cost.materials, currency)} />
            <Money label="Margin so far" value={formatMoney(cost.margin, currency)} tone={cost.margin < 0 ? "critical" : cost.revenue > 0 ? "success" : undefined} />
          </div>
          {job.budget !== undefined && used !== undefined && (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-[12px] text-text-secondary">
                <span>
                  {formatMoney(cost.cost, currency)} of {formatMoney(job.budget, currency)} budget
                </span>
                <span className={cn("tabular", used > 100 && "font-medium text-critical")}>{round(used)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
                <div className={cn("h-full rounded-full", used > 100 ? "bg-critical-fill" : used > 85 ? "bg-warning" : "bg-success")} style={{ width: `${Math.min(100, used)}%` }} />
              </div>
            </div>
          )}
          <p className="mt-2 text-[12px] text-text-tertiary">
            {[job.startOn ? `Starts ${formatDate(job.startOn)}` : "", job.dueOn ? `Due ${formatDate(job.dueOn)}` : "", job.completedAt ? `Completed ${formatDate(job.completedAt)}` : ""].filter(Boolean).join(" · ") || "No dates set"}
          </p>
        </div>

        <Block title={`People (${job.crew?.length ?? 0})`}>
          {list(
            (job.crew ?? []).map((c, i) => (
              <li key={`${c.name}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-[12.5px]">
                <span className="font-medium text-text">{c.name}</span>
                {c.role && <span className="text-text-secondary">{c.role}</span>}
                {!c.memberId && <Badge>Contractor</Badge>}
                {c.contact && <span className="ml-auto text-text-tertiary">{c.contact}</span>}
              </li>
            )),
            "Nobody assigned yet.",
          )}
        </Block>

        <Block
          title={`Sales orders (${docs.orders.length})`}
          action={adder(
            "orders",
            "File an order here",
            orders.filter((o) => !o.jobId && isOrderOpen(o)).map((o) => ({ value: o.id, label: `${o.number} · ${o.customer}` })),
          )}
        >
          {list(
            docs.orders.map((o) => row(o.id, `/orders?highlight=${o.id}`, o.number, o.customer, <StatusBadge status={o.status} />, formatMoney(round(sum(o.lines.map((l) => l.qty * l.unitPrice))), currency), () => void link("orders", o.id, null))),
            "No sales orders on this job.",
          )}
        </Block>

        <Block
          title={`Purchase orders (${docs.purchaseOrders.length})`}
          action={adder(
            "purchaseOrders",
            "File a purchase here",
            purchaseOrders.filter((p) => !p.jobId && poIsOpen(p)).map((p) => ({ value: p.id, label: `${p.number} · ${p.supplier}` })),
          )}
        >
          {list(
            docs.purchaseOrders.map((p) => row(p.id, `/orders/purchase?highlight=${p.id}`, p.number, p.supplier, <PoStatusBadge status={p.status} />, formatMoney(poTotal(p), currency), () => void link("purchaseOrders", p.id, null))),
            "No purchase orders on this job. File one here only when the goods are bought for this job, not for the shelf.",
          )}
        </Block>

        <Block
          title={`Work orders (${docs.workOrders.length})`}
          action={adder(
            "workOrders",
            "File a work order here",
            workOrders.filter((w) => !w.jobId && workOrderIsOpen(w)).map((w) => ({ value: w.id, label: `${w.number} · ${w.qty} × ${itemsById.get(w.assemblyId)?.sku ?? "?"}` })),
          )}
        >
          {list(
            docs.workOrders.map((w) => row(w.id, `/builds/work-orders?highlight=${w.id}`, w.number, `${w.qtyCompleted} of ${w.qty} × ${itemsById.get(w.assemblyId)?.sku ?? "?"}`, <WorkOrderStatusBadge status={w.status} />, null, () => void link("workOrders", w.id, null))),
            "No work orders on this job.",
          )}
          {docs.builds.length > 0 && <p className="mt-1 text-[12px] text-text-tertiary">{pluralize(docs.builds.length, "build")} booked for this job.</p>}
        </Block>

        {job.note && (
          <Block title="Note">
            <p className="whitespace-pre-wrap rounded-[var(--radius-sm)] bg-surface-subdued px-3 py-2 text-[13px] text-text-secondary">{job.note}</p>
          </Block>
        )}
      </div>
    </Drawer>
  );
}
