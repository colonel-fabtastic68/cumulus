import type { Build, Job, JobAssignee, JobStatus, PurchaseOrder, SalesOrder, StockMovement, WorkOrder } from "@/lib/types";
import type { Store, WriteOp } from "@/lib/store/types";
import { activityOp, InventoryError, nextNumber, type Actor } from "@/lib/inventory";
import { newId, nowIso, round, sum } from "@/lib/utils";

/**
 * Jobs and projects: the thing the work is for. A contractor's install, a
 * race-car build, a customer's fit-out. Sales orders, purchase orders, work
 * orders and builds point at a job with `jobId`; the job shows who is on it
 * and what it has brought in and cost so far.
 */

export const JOB_STATUS_LABEL: Record<JobStatus, string> = { open: "Open", on_hold: "On hold", completed: "Completed", cancelled: "Cancelled" };

export function jobIsOpen(job: Pick<Job, "status">): boolean {
  return job.status === "open" || job.status === "on_hold";
}

export interface JobInput {
  name: string;
  customerId?: string;
  customer?: string;
  site?: Job["site"];
  startOn?: string;
  dueOn?: string;
  crew?: JobAssignee[];
  budget?: number;
  note?: string;
}

function cleanCrew(crew?: JobAssignee[]): JobAssignee[] | undefined {
  const rows = (crew ?? []).map((c) => ({ ...c, name: c.name.trim(), role: c.role?.trim() || undefined, contact: c.contact?.trim() || undefined })).filter((c) => c.name);
  return rows.length ? rows : undefined;
}

export async function createJob(store: Store, actor: Actor, input: JobInput): Promise<Job> {
  const name = input.name.trim();
  if (!name) throw new InventoryError("Give the job a name");
  if (input.startOn && input.dueOn && input.dueOn < input.startOn) throw new InventoryError("The due date is before the start date");
  const { number, ops } = await nextNumber(store, "job");
  const now = nowIso();
  const job: Job = {
    id: newId("job"),
    number,
    name,
    customerId: input.customerId || undefined,
    customer: input.customer?.trim() || undefined,
    status: "open",
    site: input.site?.street1?.trim() ? input.site : undefined,
    startOn: input.startOn || undefined,
    dueOn: input.dueOn || undefined,
    crew: cleanCrew(input.crew),
    budget: input.budget !== undefined && Number.isFinite(input.budget) && input.budget > 0 ? input.budget : undefined,
    note: input.note?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
    createdBy: actor.id,
  };
  const all: WriteOp[] = [...ops, { op: "put", collection: "jobs", doc: job }, activityOp(actor, "job.created", `${actor.name} opened ${job.number}: ${job.name}${job.customer ? ` for ${job.customer}` : ""}`, { entityType: "job", entityId: job.id })];
  await store.batch(all);
  return job;
}

export async function updateJob(store: Store, actor: Actor, id: string, patch: Partial<JobInput> & { status?: JobStatus }): Promise<Job> {
  const job = await store.get("jobs", id);
  if (!job) throw new InventoryError("Job not found");
  const now = nowIso();
  const next: Job = {
    ...job,
    ...patch,
    name: patch.name !== undefined ? patch.name.trim() || job.name : job.name,
    crew: patch.crew !== undefined ? cleanCrew(patch.crew) : job.crew,
    site: patch.site !== undefined ? (patch.site?.street1?.trim() ? patch.site : undefined) : job.site,
    completedAt: patch.status === "completed" ? (job.completedAt ?? now) : patch.status ? undefined : job.completedAt,
    updatedAt: now,
  };
  if (next.startOn && next.dueOn && next.dueOn < next.startOn) throw new InventoryError("The due date is before the start date");
  const statusChanged = patch.status !== undefined && patch.status !== job.status;
  await store.batch([
    { op: "put", collection: "jobs", doc: next },
    ...(statusChanged ? [activityOp(actor, patch.status === "completed" ? "job.completed" : "job.updated", `${actor.name} marked ${job.number} ${JOB_STATUS_LABEL[patch.status!].toLowerCase()}`, { entityType: "job", entityId: job.id })] : []),
  ]);
  return next;
}

/** Documents that can be filed under a job. */
export type JobDocument = "orders" | "purchaseOrders" | "workOrders";

/** Files a document under a job, or takes it off one (jobId null). */
export async function assignToJob(store: Store, collection: JobDocument, id: string, jobId: string | null): Promise<void> {
  // A top-level undefined in a patch clears the field.
  await store.patch(collection, id, { jobId: jobId ?? undefined });
}

export interface JobLedger {
  orders: SalesOrder[];
  purchaseOrders: PurchaseOrder[];
  workOrders: WorkOrder[];
  builds: Build[];
}

export function jobDocuments(jobId: string, src: JobLedger): JobLedger {
  return {
    orders: src.orders.filter((o) => o.jobId === jobId),
    purchaseOrders: src.purchaseOrders.filter((p) => p.jobId === jobId),
    workOrders: src.workOrders.filter((w) => w.jobId === jobId),
    builds: src.builds.filter((b) => b.jobId === jobId),
  };
}

export interface JobCost {
  /** Sales orders on the job that were not cancelled. */
  revenue: number;
  /** Purchase orders raised for the job (not cancelled or merged away). */
  purchases: number;
  /** Components consumed by the job's builds, at what they cost when they were used. */
  materials: number;
  cost: number;
  margin: number;
  /** cost as a percentage of the budget; undefined without one. */
  budgetUsedPct?: number;
}

/**
 * What a job has brought in and cost so far. Materials come from the stock
 * ledger (build consumption for the job's builds), so they follow the
 * workspace's costing method; purchases are what was ordered for the job
 * directly. Parts bought for a job AND built into it would count twice, so a
 * purchase order that only restocks the shelf should not be filed under a job.
 */
export function jobCost(job: Pick<Job, "id" | "budget">, src: JobLedger & { movements: StockMovement[] }): JobCost {
  const docs = jobDocuments(job.id, src);
  const revenue = round(sum(docs.orders.filter((o) => o.status !== "cancelled").map((o) => sum(o.lines.map((l) => l.qty * l.unitPrice)))));
  const purchases = round(sum(docs.purchaseOrders.filter((p) => p.status !== "cancelled" && p.status !== "merged").map((p) => sum(p.lines.map((l) => l.qty * l.unitCost)))));
  const buildIds = new Set(docs.builds.map((b) => b.id));
  const materials = round(sum(src.movements.filter((m) => m.type === "build_consume" && m.refId && buildIds.has(m.refId)).map((m) => -m.qty * (m.unitCost ?? 0))));
  const cost = round(purchases + materials);
  return { revenue, purchases, materials, cost, margin: round(revenue - cost), budgetUsedPct: job.budget ? round((cost / job.budget) * 100, 1) : undefined };
}
