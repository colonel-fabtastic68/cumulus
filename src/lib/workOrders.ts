import type { BomSelection, Build, Item, RoutingStep, Serial, WorkOrder, WorkOrderComponent, WorkOrderStatus, WorkOrderStep } from "@/lib/types";
import type { Store, WriteOp } from "@/lib/store/types";
import { activityOp, buildAssembly, explodeBom, InventoryError, nextNumber, type Actor } from "@/lib/inventory";
import { bomSelectionError } from "@/lib/bomOptions";
import { toDateInput } from "@/lib/format";
import { isTracked, newSerials, SERIAL_UNFINISHED, serialEvent, serialsInStock } from "@/lib/serials";
import { currentStep, stepsFromRouting } from "@/lib/workOrderSteps";
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

/** Serial numbers for units of a serial-tracked item made on this run (feature `serials`). */
async function planSerials(store: Store, actor: Actor, item: Item, wo: WorkOrder, count: number): Promise<{ serials: Serial[]; ops: WriteOp[] }> {
  if (count <= 0) return { serials: [], ops: [] };
  const taken = (await store.list("serials")).filter((s) => s.itemId === item.id).map((s) => s.number);
  const made = newSerials(
    item,
    count,
    taken,
    { workOrderId: wo.id, ...(wo.jobId ? { jobId: wo.jobId } : {}), ...(wo.orderId ? { orderId: wo.orderId } : {}), ...(wo.locationId ? { locationId: wo.locationId } : {}), ...(wo.options ? { options: wo.options } : {}) },
    actor,
    `Planned on ${wo.number}`,
  );
  return {
    serials: made.serials,
    ops: [
      ...made.serials.map((doc): WriteOp => ({ op: "put", collection: "serials", doc })),
      ...made.events.map((doc): WriteOp => ({ op: "put", collection: "serialEvents", doc })),
      { op: "patch", collection: "items", id: item.id, patch: { serialNext: made.serialNext } },
    ],
  };
}

/** What a release adds: the item's standard steps (feature `workOrderSteps`) and serial numbers for the units (feature `serials`). */
async function releaseExtras(store: Store, actor: Actor, assembly: Item, wo: WorkOrder): Promise<{ patch: Partial<Pick<WorkOrder, "steps" | "serialIds">>; ops: WriteOp[]; numbers: string[] }> {
  const patch: Partial<Pick<WorkOrder, "steps" | "serialIds">> = {};
  const ops: WriteOp[] = [];
  let numbers: string[] = [];
  if (assembly.routing?.length && !wo.steps?.length) patch.steps = stepsFromRouting(assembly.routing, wo.startOn);
  if (isTracked(assembly) && !wo.serialIds?.length) {
    const made = await planSerials(store, actor, assembly, wo, wo.qty - wo.qtyCompleted);
    patch.serialIds = made.serials.map((s) => s.id);
    numbers = made.serials.map((s) => s.number);
    ops.push(...made.ops);
  }
  return { patch, ops, numbers };
}

function serialRange(numbers: string[]): string {
  if (numbers.length === 0) return "";
  return numbers.length === 1 ? ` · serial ${numbers[0]}` : ` · serials ${numbers[0]} to ${numbers[numbers.length - 1]}`;
}

/** The run's serials that are still being made. */
function unfinishedSerials(wo: WorkOrder, all: Serial[]): Serial[] {
  const byId = new Map(all.map((s) => [s.id, s]));
  return (wo.serialIds ?? []).map((id) => byId.get(id)).filter((s): s is Serial => !!s && SERIAL_UNFINISHED.includes(s.status));
}

function voidOps(actor: Actor, serials: Serial[], why: string, workOrderId: string): WriteOp[] {
  const now = nowIso();
  return serials.flatMap((s): WriteOp[] => [
    { op: "put", collection: "serials", doc: { ...s, status: "voided", updatedAt: now } },
    { op: "put", collection: "serialEvents", doc: serialEvent(actor, s.id, "voided", why, { workOrderId }) },
  ]);
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
  const extras = input.release ? await releaseExtras(store, actor, assembly, wo) : { patch: {}, ops: [], numbers: [] };
  Object.assign(wo, extras.patch);
  const all: WriteOp[] = [
    ...ops,
    ...extras.ops,
    { op: "put", collection: "workOrders", doc: wo },
    activityOp(actor, input.release ? "workOrder.released" : "workOrder.created", `${actor.name} ${input.release ? "released" : "planned"} ${wo.number}: ${wo.qty} × ${assembly.sku}${wo.dueOn ? `, due ${wo.dueOn}` : ""}${serialRange(extras.numbers)}`, { entityType: "workOrder", entityId: wo.id, meta: { qty: wo.qty, assembly: assembly.sku } }),
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
  // A released serial-tracked run keeps one open serial per unit still to make.
  const extra: WriteOp[] = [];
  if (wo.status !== "planned" && next.qty !== wo.qty && wo.serialIds?.length) {
    const assembly = (await store.list("items")).find((i) => i.id === wo.assemblyId);
    if (assembly && isTracked(assembly)) {
      const open = unfinishedSerials(wo, await store.list("serials"));
      const needed = next.qty - next.qtyCompleted;
      if (open.length < needed) {
        const made = await planSerials(store, actor, assembly, next, needed - open.length);
        next.serialIds = [...wo.serialIds, ...made.serials.map((s) => s.id)];
        extra.push(...made.ops);
      } else if (open.length > needed) {
        extra.push(...voidOps(actor, open.slice(needed), `Dropped when ${wo.number} went down to ${next.qty}`, wo.id));
      }
    }
  }
  await store.batch([...extra, { op: "put", collection: "workOrders", doc: next }]);
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
  let next: WorkOrder = { ...wo, status: "released", components: fixedComponents(items, assembly, wo), releasedAt: now, updatedAt: now };
  const extras = await releaseExtras(store, actor, assembly, next);
  next = { ...next, ...extras.patch };
  const short = workOrderNeeds(next, items).filter((n) => n.shortage > 0);
  await store.batch([
    ...extras.ops,
    { op: "put", collection: "workOrders", doc: next },
    activityOp(actor, "workOrder.released", `${actor.name} released ${wo.number}: ${wo.qty} × ${assembly.sku}${short.length ? ` · short on ${short.map((s) => s.item.sku).join(", ")}` : ""}${serialRange(extras.numbers)}`, { entityType: "workOrder", entityId: wo.id, meta: { short: short.map((s) => ({ sku: s.item.sku, shortage: s.shortage })) } }),
  ]);
  return next;
}

export interface CompleteWorkOrderInput {
  /** Units finished now. Defaults to everything still open. */
  qty?: number;
  /** Serial-tracked runs: which units are finished now. Defaults to the oldest open serials. */
  serialIds?: string[];
  occurredAt?: string;
  note?: string;
}

/**
 * Books finished units: a Build takes the components out and puts the units in,
 * and the run moves to in progress or completed. A planned run is released first.
 *
 * A serial-tracked item is booked one build per unit, so each serial gets its own
 * one-unit batch and cost; numbered parts it consumed are recorded as built into it.
 */
export async function completeWorkOrder(store: Store, actor: Actor, id: string, input: CompleteWorkOrderInput = {}): Promise<{ workOrder: WorkOrder; buildNumber: string }> {
  let wo = await loadWorkOrder(store, id);
  if (!workOrderIsOpen(wo)) throw new InventoryError(`${wo.number} is already ${WORK_ORDER_STATUS_LABEL[wo.status].toLowerCase()}`);
  if (wo.status === "planned") wo = await releaseWorkOrder(store, actor, id);
  const remaining = workOrderRemaining(wo);
  const qty = input.qty ?? (input.serialIds?.length || remaining);
  checkQty(qty);
  if (qty > remaining) throw new InventoryError(`Only ${remaining} of ${wo.number} are still open`);
  const note = input.note?.trim() || `Work order ${wo.number}`;
  const buildInput = { assemblyId: wo.assemblyId, consumeSubassemblies: wo.consumeSubassemblies, locationId: wo.locationId, options: wo.options, occurredAt: input.occurredAt, workOrderId: wo.id, jobId: wo.jobId };

  const items = await store.list("items");
  const assembly = items.find((i) => i.id === wo.assemblyId);
  const builds: Build[] = [];
  const serialOps: WriteOp[] = [];
  let serialIds = wo.serialIds;
  const finishedNumbers: string[] = [];

  if (assembly && isTracked(assembly)) {
    const allSerials = await store.list("serials");
    const open = unfinishedSerials(wo, allSerials);
    let chosen: Serial[];
    if (input.serialIds?.length) {
      chosen = input.serialIds.map((sid) => open.find((s) => s.id === sid)).filter((s): s is Serial => !!s);
      if (chosen.length !== input.serialIds.length) throw new InventoryError(`Some of the chosen serial numbers are not open on ${wo.number}`);
      if (chosen.length !== qty) throw new InventoryError(`Choose one serial number per unit: ${qty} for ${qty} ${qty === 1 ? "unit" : "units"}`);
    } else {
      chosen = open.slice(0, qty);
    }
    // A run released before the item was tracked by unit gets its serials now.
    if (chosen.length < qty) {
      const made = await planSerials(store, actor, assembly, wo, qty - chosen.length);
      chosen = [...chosen, ...made.serials];
      serialIds = [...(wo.serialIds ?? []), ...made.serials.map((s) => s.id)];
      serialOps.push(...made.ops);
    }
    const builtIn = new Set<string>();
    // What one unit consumes, to choose its numbered parts before building so the ledger takes their own batches.
    const perUnit = explodeFor(items, assembly, 1, wo);
    for (const serial of chosen) {
      const children = new Map<string, Serial[]>();
      for (const r of perUnit) {
        if (!isTracked(r.item)) continue;
        const take = serialsInStock(allSerials, r.item.id, wo.locationId).filter((s) => !builtIn.has(s.id));
        const pick = (take.length ? take : serialsInStock(allSerials, r.item.id).filter((s) => !builtIn.has(s.id))).slice(0, Math.round(r.required));
        pick.forEach((s) => builtIn.add(s.id));
        if (pick.length) children.set(r.item.id, pick);
      }
      const fromLotIds = Object.fromEntries([...children].map(([itemId, list]) => [itemId, list.map((s) => s.lotId).filter((id): id is string => !!id)]));
      const build = await buildAssembly(store, actor, { ...buildInput, qty: 1, note: `${note} · ${serial.number}`, fromLotIds });
      builds.push(build);
      finishedNumbers.push(serial.number);
      const at = build.completedAt ?? nowIso();
      const now = nowIso();
      serialOps.push(
        { op: "put", collection: "serials", doc: { ...serial, status: "in_stock", lotId: build.lotId, buildId: build.id, ...(wo.locationId ? { locationId: wo.locationId } : {}), ...(wo.options ? { options: wo.options } : {}), finishedAt: at, updatedAt: now } },
        { op: "put", collection: "serialEvents", doc: serialEvent(actor, serial.id, "finished", `Finished on ${wo.number} (${build.number})`, { occurredAt: at, workOrderId: wo.id }) },
      );
      // The numbered parts chosen above are recorded as built into this unit.
      for (const [itemId, take] of children) {
        const part = items.find((i) => i.id === itemId)!;
        for (const child of take) {
          builtIn.add(child.id);
          serialOps.push(
            { op: "put", collection: "serials", doc: { ...child, status: "installed", parentSerialId: serial.id, installedAt: at, updatedAt: now } },
            { op: "put", collection: "serialEvents", doc: serialEvent(actor, child.id, "installed", `Built into ${serial.number} on ${wo.number}`, { occurredAt: at, workOrderId: wo.id, otherSerialId: serial.id }) },
            { op: "put", collection: "serialEvents", doc: serialEvent(actor, serial.id, "received_part", `${child.number} (${part.sku}) built in`, { occurredAt: at, workOrderId: wo.id, otherSerialId: child.id }) },
          );
        }
      }
    }
  } else {
    builds.push(await buildAssembly(store, actor, { ...buildInput, qty, note }));
  }

  const consumed = new Map<string, number>();
  for (const b of builds) for (const c of b.components) consumed.set(c.itemId, round((consumed.get(c.itemId) ?? 0) + c.qtyConsumed, 4));
  const components = wo.components.map((c) => ({ ...c, qtyConsumed: round(c.qtyConsumed + (consumed.get(c.itemId) ?? 0), 3) }));
  // A substitution made at build time (a sub-assembly exploded because it was short) lands as its own line.
  for (const [itemId, used] of consumed) if (!components.some((c) => c.itemId === itemId)) components.push({ itemId, qtyRequired: used, qtyConsumed: used });
  const qtyCompleted = round(wo.qtyCompleted + qty, 3);
  const done = qtyCompleted >= wo.qty;
  const now = nowIso();
  const buildNumber = builds.length > 2 ? `${builds[0]!.number} to ${builds[builds.length - 1]!.number}` : builds.map((b) => b.number).join(", ");
  const next: WorkOrder = { ...wo, qtyCompleted, components, status: done ? "completed" : "in_progress", buildIds: [...(wo.buildIds ?? []), ...builds.map((b) => b.id)], ...(serialIds ? { serialIds } : {}), startedAt: wo.startedAt ?? now, completedAt: done ? now : undefined, updatedAt: now };
  const serialsNote = finishedNumbers.length ? ` · ${finishedNumbers.join(", ")}` : "";
  await store.batch([
    ...serialOps,
    { op: "put", collection: "workOrders", doc: next },
    activityOp(actor, done ? "workOrder.completed" : "workOrder.progress", done ? `${actor.name} completed ${wo.number} (${buildNumber})${serialsNote}` : `${actor.name} booked ${qty} of ${wo.qty} on ${wo.number} (${buildNumber})${serialsNote}`, { entityType: "workOrder", entityId: wo.id, meta: { buildIds: builds.map((b) => b.id), qty } }),
  ]);
  return { workOrder: next, buildNumber };
}

/** Stops a run. Units already booked stay built; the rest of the parts are no longer committed. */
export async function cancelWorkOrder(store: Store, actor: Actor, id: string, reason?: string): Promise<WorkOrder> {
  const wo = await loadWorkOrder(store, id);
  if (!workOrderIsOpen(wo)) throw new InventoryError(`${wo.number} is already ${WORK_ORDER_STATUS_LABEL[wo.status].toLowerCase()}`);
  const now = nowIso();
  const next: WorkOrder = { ...wo, status: "cancelled", cancelledAt: now, updatedAt: now, note: reason?.trim() ? [wo.note, `Cancelled: ${reason.trim()}`].filter(Boolean).join("\n") : wo.note };
  // Serials of units never made are cancelled with the run; finished ones keep their history.
  const voided = wo.serialIds?.length ? voidOps(actor, unfinishedSerials(wo, await store.list("serials")), `Cancelled with ${wo.number}`, wo.id) : [];
  await store.batch([
    ...voided,
    { op: "put", collection: "workOrders", doc: next },
    activityOp(actor, "workOrder.cancelled", `${actor.name} cancelled ${wo.number}${reason?.trim() ? `: ${reason.trim()}` : ""}${wo.qtyCompleted > 0 ? ` (${wo.qtyCompleted} units already built stay in stock)` : ""}`, { entityType: "workOrder", entityId: wo.id }),
  ]);
  return next;
}

// ---- Steps (feature `workOrderSteps`) ---------------------------------------

export type StepAction = "start" | "finish" | "skip";

const STEP_VERB: Record<StepAction, string> = { start: "started", finish: "finished", skip: "skipped" };

/**
 * Starts, finishes or skips the run's current step. Steps are worked in order, so only the
 * first step not yet done or skipped can move. Finishing a step that was never started
 * starts and finishes it at once. The run's unfinished serials get a line in their history.
 */
export async function advanceWorkOrderStep(store: Store, actor: Actor, id: string, stepId: string, action: StepAction, opts: { occurredAt?: string; note?: string } = {}): Promise<WorkOrder> {
  const wo = await loadWorkOrder(store, id);
  if (!workOrderIsOpen(wo)) throw new InventoryError(`${wo.number} is ${WORK_ORDER_STATUS_LABEL[wo.status].toLowerCase()}`);
  if (wo.status === "planned") throw new InventoryError(`Release ${wo.number} before working its steps`);
  const steps = wo.steps ?? [];
  const idx = steps.findIndex((s) => s.id === stepId);
  if (idx < 0) throw new InventoryError("That step is no longer on this work order");
  const current = currentStep(wo);
  if (!current) throw new InventoryError(`Every step on ${wo.number} is already done`);
  if (current.id !== stepId) throw new InventoryError(`Steps are worked in order: finish or skip "${current.name}" first`);
  if (action === "start" && current.status === "in_progress") throw new InventoryError(`"${current.name}" is already started`);

  const at = opts.occurredAt ?? nowIso();
  const step: WorkOrderStep = { ...current, ...(opts.note?.trim() ? { note: opts.note.trim() } : {}) };
  if (action === "start") {
    step.status = "in_progress";
    step.startedAt = at;
  } else {
    step.status = action === "finish" ? "done" : "skipped";
    if (action === "finish") step.startedAt = step.startedAt ?? at;
    step.finishedAt = at;
    step.finishedBy = actor.id;
  }
  const now = nowIso();
  const next: WorkOrder = { ...wo, steps: steps.map((s, i) => (i === idx ? step : s)), startedAt: wo.startedAt ?? (action === "skip" ? undefined : at), updatedAt: now };
  const label = `${step.name}${step.workCenter ? ` at ${step.workCenter}` : ""}`;
  const kind = action === "start" ? "step_started" : action === "finish" ? "step_finished" : "step_skipped";
  const text = `${action === "start" ? "Started" : action === "finish" ? "Finished" : "Skipped"} ${label}${step.outside && action === "start" ? " (outside)" : ""}`;

  const ops: WriteOp[] = [];
  if (wo.serialIds?.length) {
    for (const s of unfinishedSerials(wo, await store.list("serials"))) {
      if (action !== "skip" && s.status === "planned") ops.push({ op: "put", collection: "serials", doc: { ...s, status: "in_production", updatedAt: now } });
      ops.push({ op: "put", collection: "serialEvents", doc: serialEvent(actor, s.id, kind, text, { occurredAt: at, workOrderId: wo.id, stepId: step.id }) });
    }
  }
  await store.batch([
    ...ops,
    { op: "put", collection: "workOrders", doc: next },
    activityOp(actor, "workOrder.step", `${actor.name} ${STEP_VERB[action]} ${step.name} on ${wo.number}`, { entityType: "workOrder", entityId: wo.id, meta: { step: step.name, action } }),
  ]);
  return next;
}

/** Adds a step at the end of an open run, for work its item's standard steps do not cover. */
export async function addWorkOrderStep(store: Store, actor: Actor, id: string, input: RoutingStep): Promise<WorkOrder> {
  const wo = await loadWorkOrder(store, id);
  if (!workOrderIsOpen(wo)) throw new InventoryError(`${wo.number} is ${WORK_ORDER_STATUS_LABEL[wo.status].toLowerCase()}`);
  const [step] = stepsFromRouting([input]);
  if (!step) throw new InventoryError("Give the step a name");
  const next: WorkOrder = { ...wo, steps: [...(wo.steps ?? []), step], updatedAt: nowIso() };
  await store.put("workOrders", next);
  return next;
}

/** Removes a step that has not been started. */
export async function removeWorkOrderStep(store: Store, actor: Actor, id: string, stepId: string): Promise<WorkOrder> {
  const wo = await loadWorkOrder(store, id);
  if (!workOrderIsOpen(wo)) throw new InventoryError(`${wo.number} is ${WORK_ORDER_STATUS_LABEL[wo.status].toLowerCase()}`);
  const step = wo.steps?.find((s) => s.id === stepId);
  if (!step) throw new InventoryError("That step is no longer on this work order");
  if (step.status !== "pending") throw new InventoryError(`"${step.name}" has already been ${step.status === "in_progress" ? "started" : step.status}; it stays in the record`);
  const next: WorkOrder = { ...wo, steps: (wo.steps ?? []).filter((s) => s.id !== stepId), updatedAt: nowIso() };
  await store.put("workOrders", next);
  return next;
}
