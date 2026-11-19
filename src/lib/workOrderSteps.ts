import { addDays } from "@/lib/calendar";
import { formatDate, toDateInput } from "@/lib/format";
import type { RoutingStep, WorkOrder, WorkOrderStep, WorkOrderStepStatus } from "@/lib/types";
import { newId } from "@/lib/utils";

/**
 * Work order steps (feature `workOrderSteps`): the ordered steps of one run, such as
 * Cut → Weld → Powder coat (outside) → Assemble → Check.
 *
 * An item keeps its standard steps (its routing); releasing a work order copies
 * them onto the run with planned dates laid end to end from the run's start.
 * Steps are worked in order: the current step is the first one not yet done or
 * skipped, and it is what the run's status line reports.
 *
 * Plain functions only; starting, finishing and skipping steps are in
 * src/lib/workOrders.ts.
 */

export const STEP_STATUS_LABEL: Record<WorkOrderStepStatus, string> = { pending: "Not started", in_progress: "In progress", done: "Done", skipped: "Skipped" };

/** The run's steps from an item's routing, each starting the day after the one before finishes. */
export function stepsFromRouting(routing: RoutingStep[], startOn?: string): WorkOrderStep[] {
  let cursor = startOn;
  return routing
    .filter((r) => r.name.trim())
    .map((r) => {
      const days = r.days && r.days > 0 ? Math.round(r.days) : undefined;
      const plannedStart = cursor;
      const plannedFinish = plannedStart && days ? addDays(plannedStart, days - 1) : undefined;
      cursor = plannedFinish ? addDays(plannedFinish, 1) : undefined;
      return {
        id: newId("stp"),
        name: r.name.trim(),
        ...(r.workCenter?.trim() ? { workCenter: r.workCenter.trim() } : {}),
        ...(r.outside ? { outside: true } : {}),
        status: "pending" as const,
        ...(plannedStart ? { plannedStart } : {}),
        ...(plannedFinish ? { plannedFinish } : {}),
      };
    });
}

/** Clean up a routing typed on the item page: blank names dropped, days whole and above zero. */
export function cleanRouting(routing: RoutingStep[]): RoutingStep[] {
  return routing
    .map((r) => ({
      name: r.name.trim(),
      ...(r.workCenter?.trim() ? { workCenter: r.workCenter.trim() } : {}),
      ...(r.outside ? { outside: true } : {}),
      ...(r.days && r.days > 0 ? { days: Math.round(r.days) } : {}),
    }))
    .filter((r) => r.name);
}

export function stepIsOpen(step: Pick<WorkOrderStep, "status">): boolean {
  return step.status === "pending" || step.status === "in_progress";
}

/** The step the run is on: the first one not yet done or skipped. */
export function currentStep(wo: Pick<WorkOrder, "steps">): WorkOrderStep | undefined {
  return wo.steps?.find(stepIsOpen);
}

export function stepsProgress(wo: Pick<WorkOrder, "steps">): { done: number; total: number } {
  const steps = wo.steps ?? [];
  return { done: steps.filter((s) => !stepIsOpen(s)).length, total: steps.length };
}

/** A step running past its planned finish, or not started by its planned start. */
export function stepIsLate(step: WorkOrderStep, today = toDateInput()): boolean {
  if (step.status === "in_progress") return !!step.plannedFinish && step.plannedFinish < today;
  if (step.status === "pending") return !!step.plannedStart && step.plannedStart < today;
  return false;
}

function where(step: WorkOrderStep): string {
  return step.workCenter ? ` (${step.workCenter})` : "";
}

/**
 * One line for where the run stands, e.g. "At Powder coat (Coater) since Nov 12, due back Nov 19".
 * Undefined for a run without steps.
 */
export function stepStatusLine(wo: Pick<WorkOrder, "steps" | "status">): string | undefined {
  const steps = wo.steps ?? [];
  if (steps.length === 0) return undefined;
  const step = currentStep(wo);
  if (!step) return "All steps done";
  if (step.status === "in_progress") {
    const since = step.startedAt ? ` since ${formatDate(step.startedAt)}` : "";
    const due = step.plannedFinish ? `, due ${step.outside ? "back " : ""}${formatDate(step.plannedFinish)}` : "";
    return `${step.outside ? "At" : "In"} ${step.name}${where(step)}${since}${due}`;
  }
  return `Next: ${step.name}${where(step)}${step.plannedStart ? ` from ${formatDate(step.plannedStart)}` : ""}`;
}
