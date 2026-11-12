import type { BomSelection, Item, WorkOrder, WorkOrderComponent, WorkOrderStatus } from "@/lib/types";
import type { Store, WriteOp } from "@/lib/store/types";
import { activityOp, buildAssembly, explodeBom, InventoryError, nextNumber, type Actor } from "@/lib/inventory";
import { bomSelectionError } from "@/lib/bomOptions";
import { toDateInput } from "@/lib/format";
import { newId, nowIso, round, sum } from "@/lib/utils";

/**
 * Work orders: production that is planned before it happens.
 *
 * A Build (src/lib/inventory.ts) is the moment components become a finished
 * unit. A work order is the plan around it: what to make, how many, when, for
 * which order or job, and who is on it.
 *
 *   planned      a date on the schedule; the BOM can still change
 *   released     the component list is fixed; the parts are committed
 *   in_progress  some units are done
 *   completed    every unit is booked
 *
 * Stock moves when units are completed: each completion books a Build, which
 * takes the components out and puts the finished units in (backflush). Until
 * then the parts stay on hand but count as committed, which is what the WIP
 * view and the shortage check show.
 */

export const WORK_ORDER_OPEN: WorkOrderStatus[] = ["planned", "released", "in_progress"];

export const WORK_ORDER_STATUS_LABEL: Record<WorkOrderStatus, string> = {
  planned: "Planned",
  released: "Released",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function workOrderIsOpen(wo: Pick<WorkOrder, "status">): boolean {
  return WORK_ORDER_OPEN.includes(wo.status);
}

/** Units still to make. */
export function workOrderRemaining(wo: Pick<WorkOrder, "qty" | "qtyCompleted">): number {
  return Math.max(0, round(wo.qty - wo.qtyCompleted, 3));
}

export function workOrderProgressPct(wo: Pick<WorkOrder, "qty" | "qtyCompleted">): number {
  return wo.qty > 0 ? Math.min(100, round((wo.qtyCompleted / wo.qty) * 100, 1)) : 0;
}

/** Past its due date and not finished. */
export function workOrderIsLate(wo: Pick<WorkOrder, "status" | "dueOn">, today = toDateInput()): boolean {
  return workOrderIsOpen(wo) && !!wo.dueOn && wo.dueOn < today;
}

function explodeFor(items: Item[], assembly: Item, qty: number, wo: Pick<WorkOrder, "consumeSubassemblies" | "options">) {
  return explodeBom(items, assembly, qty, { consumeSubassemblies: wo.consumeSubassemblies, explodeShortfallOnly: !wo.consumeSubassemblies, selection: wo.options });
}

export interface WorkOrderNeed {
  item: Item;
  /** Still to be consumed by the units not yet completed. */
  required: number;
  available: number;
  shortage: number;
}

/** What the rest of a run needs against what is on the shelf now. Planned runs read the BOM as it stands today. */
export function workOrderNeeds(wo: WorkOrder, items: Item[]): WorkOrderNeed[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const assembly = byId.get(wo.assemblyId);
  const remaining = workOrderRemaining(wo);
  if (!assembly || remaining <= 0) return [];
  if (wo.components.length > 0) {
    return wo.components.flatMap((c) => {
      const item = byId.get(c.itemId);
      const required = Math.max(0, round(c.qtyRequired - c.qtyConsumed, 3));
      return item && required > 0 ? [{ item, required, available: item.onHand, shortage: round(Math.max(0, required - item.onHand), 3) }] : [];
    });
  }
  return explodeFor(items, assembly, remaining, wo).map((r) => ({ item: r.item, required: r.required, available: r.available, shortage: r.shortage }));
}

/** Units of each part that released and in-progress runs will still consume: on the shelf, but spoken for. */
export function committedToProduction(workOrders: WorkOrder[], items: Item[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const wo of workOrders) {
    if (wo.status !== "released" && wo.status !== "in_progress") continue;
    for (const n of workOrderNeeds(wo, items)) out.set(n.item.id, round((out.get(n.item.id) ?? 0) + n.required, 3));
  }
  return out;
}

/** Value of the parts committed to released and in-progress runs, at current cost. */
export function committedValue(workOrders: WorkOrder[], items: Item[]): number {
  const byId = new Map(items.map((i) => [i.id, i]));
  return round(sum(Array.from(committedToProduction(workOrders, items), ([id, qty]) => qty * (byId.get(id)?.unitCost ?? 0))));
}

/** Monday of the week a date falls in, as YYYY-MM-DD: the bucket key for the schedule. */
export function weekOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(y!, (m ?? 1) - 1, d ?? 1);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return toDateInput(day.toISOString());
}

export interface ScheduleWeek {
  /** Monday (YYYY-MM-DD); "" for runs with no date. */
  week: string;
  workOrders: WorkOrder[];
  units: number;
}

/** Open runs grouped by the week they are due (or start, when no due date), earliest first; undated runs last. */
export function productionSchedule(workOrders: WorkOrder[]): ScheduleWeek[] {
  const weeks = new Map<string, WorkOrder[]>();
  for (const wo of workOrders) {
    if (!workOrderIsOpen(wo)) continue;
    const date = wo.dueOn ?? wo.startOn;
    const key = date ? weekOf(date) : "";
    weeks.set(key, [...(weeks.get(key) ?? []), wo]);
  }
  const rank = { high: 0, normal: 1, low: 2 } as const;
  return Array.from(weeks, ([week, rows]) => ({
    week,
    workOrders: rows.sort((a, b) => (a.dueOn ?? a.startOn ?? "9").localeCompare(b.dueOn ?? b.startOn ?? "9") || rank[a.priority ?? "normal"] - rank[b.priority ?? "normal"] || a.number.localeCompare(b.number)),
    units: sum(rows.map(workOrderRemaining)),
  })).sort((a, b) => (a.week || "9").localeCompare(b.week || "9"));
}

export interface WorkOrderInput {
  assemblyId: string;
  qty: number;
  startOn?: string;
  dueOn?: string;
  priority?: WorkOrder["priority"];
  locationId?: string;
  consumeSubassemblies?: boolean;
  options?: BomSelection;
  orderId?: string;
  jobId?: string;
  assignedTo?: string[];
  note?: string;
  /** Release straight away instead of leaving it planned. */
  release?: boolean;
}

function checkQty(qty: number) {
  if (!Number.isFinite(qty) || qty <= 0) throw new InventoryError("A work order needs a quantity above zero");
  if (!Number.isInteger(qty)) throw new InventoryError("Work order quantity must be a whole number");
}

function checkDates(startOn?: string, dueOn?: string) {
  if (startOn && dueOn && dueOn < startOn) throw new InventoryError("The due date is before the start date");
}

function fixedComponents(items: Item[], assembly: Item, wo: Pick<WorkOrder, "qty" | "consumeSubassemblies" | "options">): WorkOrderComponent[] {
  return explodeFor(items, assembly, wo.qty, wo).map((r) => ({ itemId: r.item.id, qtyRequired: r.required, qtyConsumed: 0 }));
}

export async function createWorkOrder(store: Store, actor: Actor, input: WorkOrderInput): Promise<WorkOrder> {
  const items = await store.list("items");
  const assembly = items.find((i) => i.id === input.assemblyId);
  if (!assembly) throw new InventoryError("Choose the assembly to build");
  if (assembly.bom.length === 0) throw new InventoryError(`${assembly.sku} has no bill of materials`);
  checkQty(input.qty);
  checkDates(input.startOn, input.dueOn);
  const optionsError = bomSelectionError(assembly.bom, input.options);
  if (optionsError) throw new InventoryError(`${assembly.sku}: ${optionsError}`);
  const { number, ops } = await nextNumber(store, "workOrder");
  const now = nowIso();
  const base = { qty: input.qty, consumeSubassemblies: input.consumeSubassemblies ?? true, options: input.options };
  const wo: WorkOrder = {
    id: newId("wo"),
    number,
    assemblyId: assembly.id,
    qty: input.qty,
    qtyCompleted: 0,
    status: input.release ? "released" : "planned",
    priority: input.priority ?? "normal",
    startOn: input.startOn || undefined,
    dueOn: input.dueOn || undefined,
    locationId: input.locationId || undefined,
    consumeSubassemblies: base.consumeSubassemblies,
    options: input.options,
    components: input.release ? fixedComponents(items, assembly, base) : [],
    orderId: input.orderId || undefined,
    jobId: input.jobId || undefined,
    assignedTo: input.assignedTo?.length ? input.assignedTo : undefined,
    buildIds: [],
    note: input.note?.trim() || undefined,
    releasedAt: input.release ? now : undefined,
    createdAt: now,
    updatedAt: now,
    createdBy: actor.id,
  };
  const all: WriteOp[] = [
    ...ops,
    { op: "put", collection: "workOrders", doc: wo },
    activityOp(actor, input.release ? "workOrder.released" : "workOrder.created", `${actor.name} ${input.release ? "released" : "planned"} ${wo.number}: ${wo.qty} × ${assembly.sku}${wo.dueOn ? `, due ${wo.dueOn}` : ""}`, { entityType: "workOrder", entityId: wo.id, meta: { qty: wo.qty, assembly: assembly.sku } }),
  ];
  await store.batch(all);
  return wo;
}

async function loadWorkOrder(store: Store, id: string): Promise<WorkOrder> {
  const wo = await store.get("workOrders", id);
  if (!wo) throw new InventoryError("Work order not found");
  return wo;
}

export type WorkOrderPatch = Partial<Pick<WorkOrder, "qty" | "startOn" | "dueOn" | "priority" | "locationId" | "options" | "orderId" | "jobId" | "assignedTo" | "note">>;

/** Edits an open run. Changing the quantity or the options of a released run re-fixes its component list, keeping what was already consumed. */
export async function updateWorkOrder(store: Store, actor: Actor, id: string, patch: WorkOrderPatch): Promise<WorkOrder> {
  const wo = await loadWorkOrder(store, id);
  if (!workOrderIsOpen(wo)) throw new InventoryError(`${wo.number} is ${WORK_ORDER_STATUS_LABEL[wo.status].toLowerCase()} and cannot be edited`);
  const next: WorkOrder = { ...wo, ...patch, updatedAt: nowIso() };
  checkQty(next.qty);
  checkDates(next.startOn, next.dueOn);
  if (next.qty < wo.qtyCompleted) throw new InventoryError(`${wo.qtyCompleted} units of ${wo.number} are already done; the quantity cannot go below that`);
  if (wo.status !== "planned" && (patch.qty !== undefined || patch.options !== undefined)) {
    const items = await store.list("items");
    const assembly = items.find((i) => i.id === wo.assemblyId);
    if (!assembly) throw new InventoryError("The assembly on this work order no longer exists");
    const optionsError = bomSelectionError(assembly.bom, next.options);
    if (optionsError) throw new InventoryError(`${assembly.sku}: ${optionsError}`);
    const consumed = new Map(wo.components.map((c) => [c.itemId, c.qtyConsumed]));
    const fresh = fixedComponents(items, assembly, next).map((c) => ({ ...c, qtyConsumed: consumed.get(c.itemId) ?? 0 }));
    // Parts already consumed that the new list no longer calls for stay on the record.
    const kept = wo.components.filter((c) => c.qtyConsumed > 0 && !fresh.some((f) => f.itemId === c.itemId)).map((c) => ({ ...c, qtyRequired: c.qtyConsumed }));
    next.components = [...fresh, ...kept];
  }
  await store.put("workOrders", next);
  return next;
}

/** Fixes the component list from the BOM as it stands and commits the parts. */
export async function releaseWorkOrder(store: Store, actor: Actor, id: string): Promise<WorkOrder> {
  const wo = await loadWorkOrder(store, id);
  if (wo.status !== "planned") throw new InventoryError(`${wo.number} is already ${WORK_ORDER_STATUS_LABEL[wo.status].toLowerCase()}`);
  const items = await store.list("items");
  const assembly = items.find((i) => i.id === wo.assemblyId);
  if (!assembly) throw new InventoryError("The assembly on this work order no longer exists");
  if (assembly.bom.length === 0) throw new InventoryError(`${assembly.sku} has no bill of materials`);
  const now = nowIso();
  const next: WorkOrder = { ...wo, status: "released", components: fixedComponents(items, assembly, wo), releasedAt: now, updatedAt: now };
  const short = workOrderNeeds(next, items).filter((n) => n.shortage > 0);
  await store.batch([
    { op: "put", collection: "workOrders", doc: next },
    activityOp(actor, "workOrder.released", `${actor.name} released ${wo.number}: ${wo.qty} × ${assembly.sku}${short.length ? ` · short on ${short.map((s) => s.item.sku).join(", ")}` : ""}`, { entityType: "workOrder", entityId: wo.id, meta: { short: short.map((s) => ({ sku: s.item.sku, shortage: s.shortage })) } }),
  ]);
  return next;
}

export interface CompleteWorkOrderInput {
  /** Units finished now. Defaults to everything still open. */
  qty?: number;
  occurredAt?: string;
  note?: string;
}

/**
 * Books finished units: a Build takes the components out and puts the units in,
 * and the run moves to in progress or completed. A planned run is released first.
 */
export async function completeWorkOrder(store: Store, actor: Actor, id: string, input: CompleteWorkOrderInput = {}): Promise<{ workOrder: WorkOrder; buildNumber: string }> {
  let wo = await loadWorkOrder(store, id);
  if (!workOrderIsOpen(wo)) throw new InventoryError(`${wo.number} is already ${WORK_ORDER_STATUS_LABEL[wo.status].toLowerCase()}`);
  if (wo.status === "planned") wo = await releaseWorkOrder(store, actor, id);
  const remaining = workOrderRemaining(wo);
  const qty = input.qty ?? remaining;
  checkQty(qty);
  if (qty > remaining) throw new InventoryError(`Only ${remaining} of ${wo.number} are still open`);
  const build = await buildAssembly(store, actor, {
    assemblyId: wo.assemblyId,
    qty,
    consumeSubassemblies: wo.consumeSubassemblies,
    locationId: wo.locationId,
    options: wo.options,
    occurredAt: input.occurredAt,
    workOrderId: wo.id,
    jobId: wo.jobId,
    note: input.note?.trim() || `Work order ${wo.number}`,
  });
  const consumed = new Map(build.components.map((c) => [c.itemId, c.qtyConsumed]));
  const components = wo.components.map((c) => ({ ...c, qtyConsumed: round(c.qtyConsumed + (consumed.get(c.itemId) ?? 0), 3) }));
  // A substitution made at build time (a sub-assembly exploded because it was short) lands as its own line.
  for (const [itemId, used] of consumed) if (!components.some((c) => c.itemId === itemId)) components.push({ itemId, qtyRequired: used, qtyConsumed: used });
  const qtyCompleted = round(wo.qtyCompleted + qty, 3);
  const done = qtyCompleted >= wo.qty;
  const now = nowIso();
  const next: WorkOrder = { ...wo, qtyCompleted, components, status: done ? "completed" : "in_progress", buildIds: [...(wo.buildIds ?? []), build.id], startedAt: wo.startedAt ?? now, completedAt: done ? now : undefined, updatedAt: now };
  await store.batch([
    { op: "put", collection: "workOrders", doc: next },
    activityOp(actor, done ? "workOrder.completed" : "workOrder.progress", done ? `${actor.name} completed ${wo.number} (${build.number})` : `${actor.name} booked ${qty} of ${wo.qty} on ${wo.number} (${build.number})`, { entityType: "workOrder", entityId: wo.id, meta: { buildId: build.id, qty } }),
  ]);
  return { workOrder: next, buildNumber: build.number };
}

/** Stops a run. Units already booked stay built; the rest of the parts are no longer committed. */
export async function cancelWorkOrder(store: Store, actor: Actor, id: string, reason?: string): Promise<WorkOrder> {
  const wo = await loadWorkOrder(store, id);
  if (!workOrderIsOpen(wo)) throw new InventoryError(`${wo.number} is already ${WORK_ORDER_STATUS_LABEL[wo.status].toLowerCase()}`);
  const now = nowIso();
  const next: WorkOrder = { ...wo, status: "cancelled", cancelledAt: now, updatedAt: now, note: reason?.trim() ? [wo.note, `Cancelled: ${reason.trim()}`].filter(Boolean).join("\n") : wo.note };
  await store.batch([
    { op: "put", collection: "workOrders", doc: next },
    activityOp(actor, "workOrder.cancelled", `${actor.name} cancelled ${wo.number}${reason?.trim() ? `: ${reason.trim()}` : ""}${wo.qtyCompleted > 0 ? ` (${wo.qtyCompleted} units already built stay in stock)` : ""}`, { entityType: "workOrder", entityId: wo.id }),
  ]);
  return next;
}
