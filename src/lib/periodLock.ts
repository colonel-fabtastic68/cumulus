import type { PeriodLock, WorkspaceSettings } from "@/lib/types";
import type { Store } from "@/lib/store/types";
import { activityOp, type Actor } from "@/lib/inventory";
import { formatDate, toDateInput } from "@/lib/format";
import { nowIso } from "@/lib/utils";
import { seedSettings } from "@/lib/seed";

/**
 * Period close. Once a month or quarter has been reported, its numbers should
 * stop moving: closing the books through a date makes the ledger refuse any
 * stock movement dated on or before it (a back-dated receipt, an adjustment
 * "as of" last month). Nothing already recorded changes, and today's work is
 * untouched. An owner or admin closes and reopens; the check itself lives in
 * the ledger (movementOps), so it holds for the app, imports and Strato alike.
 */

/** The calendar day a movement falls on, as YYYY-MM-DD. */
function dayOf(occurredAt: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(occurredAt) ? occurredAt : toDateInput(occurredAt);
}

export function isPeriodLocked(settings: Pick<WorkspaceSettings, "periodLock"> | null | undefined, occurredAt: string): boolean {
  const through = settings?.periodLock?.through;
  return !!through && dayOf(occurredAt) <= through;
}

export function periodLockMessage(lock: PeriodLock): string {
  return `The books are closed through ${formatDate(lock.through)}. Date this on a later day, or ask an owner or admin to reopen the period in Settings.`;
}

/** Last day of the month before `today` (YYYY-MM-DD): the usual thing to close. */
export function lastMonthEnd(today = new Date()): string {
  return toDateInput(new Date(today.getFullYear(), today.getMonth(), 0).toISOString());
}

/** Last day of the quarter before `today`. */
export function lastQuarterEnd(today = new Date()): string {
  const firstMonthOfQuarter = Math.floor(today.getMonth() / 3) * 3;
  return toDateInput(new Date(today.getFullYear(), firstMonthOfQuarter, 0).toISOString());
}

export async function closePeriod(store: Store, actor: Actor, through: string, note?: string): Promise<PeriodLock> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(through)) throw new Error("Pick the last day of the period to close");
  if (through >= toDateInput()) throw new Error("A period can only be closed through a day that has ended");
  const existing = await store.get("settings", "default");
  const lock: PeriodLock = { through, lockedAt: nowIso(), lockedBy: actor.id, lockedByName: actor.name, ...(note?.trim() ? { note: note.trim() } : {}) };
  const patch = { periodLock: lock, updatedAt: nowIso() };
  await store.batch([
    existing ? { op: "patch", collection: "settings", id: "default", patch } : { op: "put", collection: "settings", doc: { ...seedSettings(), ...patch, id: "default" } },
    activityOp(actor, "period.closed", `${actor.name} closed the books through ${formatDate(through)}`, { meta: { through, ...(existing?.periodLock ? { previous: existing.periodLock.through } : {}) } }),
  ]);
  return lock;
}

export async function reopenPeriod(store: Store, actor: Actor): Promise<void> {
  const settings = await store.get("settings", "default");
  if (!settings?.periodLock) return;
  const through = settings.periodLock.through;
  await store.batch([
    // A top-level undefined in a patch clears the field in both stores.
    { op: "patch", collection: "settings", id: "default", patch: { periodLock: undefined, updatedAt: nowIso() } },
    activityOp(actor, "period.reopened", `${actor.name} reopened the books (they were closed through ${formatDate(through)})`, { meta: { through } }),
  ]);
}
