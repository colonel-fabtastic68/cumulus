"use client";

import type { WorkOrder, WorkOrderStatus } from "@/lib/types";
import { WORK_ORDER_STATUS_LABEL, workOrderIsLate } from "@/lib/workOrders";
import { formatDate } from "@/lib/format";
import { Badge, type BadgeTone } from "@/components/ui";

const TONE: Record<WorkOrderStatus, BadgeTone> = { planned: "default", released: "info", in_progress: "attention", completed: "success", cancelled: "default" };

export function WorkOrderStatusBadge({ status }: { status: WorkOrderStatus }) {
  return <Badge tone={TONE[status]}>{WORK_ORDER_STATUS_LABEL[status]}</Badge>;
}

export const PRIORITY_OPTIONS: Array<{ value: NonNullable<WorkOrder["priority"]>; label: string }> = [
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

/** "Due Dec 4" with a Late chip once the date has passed on an open run. */
export function DueCell({ wo }: { wo: WorkOrder }) {
  if (!wo.dueOn) return <span className="text-text-tertiary">—</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="whitespace-nowrap text-text-secondary">{formatDate(wo.dueOn)}</span>
      {workOrderIsLate(wo) && <Badge tone="warning">Late</Badge>}
    </span>
  );
}

/** A thin progress bar with "3 / 10" beside it. */
export function ProgressCell({ wo }: { wo: Pick<WorkOrder, "qty" | "qtyCompleted"> }) {
  const pct = wo.qty > 0 ? Math.min(100, (wo.qtyCompleted / wo.qty) * 100) : 0;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
        <span className="absolute inset-y-0 left-0 rounded-full bg-success" style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular text-text-secondary">
        {wo.qtyCompleted} / {wo.qty}
      </span>
    </span>
  );
}
