import type { Item, RefType, StockMovement } from "@/lib/types";
import type { WriteOp } from "@/lib/store/types";
import { activityOp, type Actor } from "@/lib/inventory";
import { formatMoney } from "@/lib/format";
import { newId, nowIso, round } from "@/lib/utils";

/**
 * Revaluation (feature `valuationAudit`): under standard costing, a new standard cost changes the
 * value of every unit already on the shelf, not only the units just received or built. That change
 * is posted to the ledger as its own movement, with no quantity, the old and new cost and the
 * dollar amount, and logged in Activity, so the books never move without a trace.
 */

export interface PendingRevaluation {
  item: Pick<Item, "id" | "sku" | "unit">;
  /** Units on hand the new cost applies to. */
  qty: number;
  fromCost: number;
  toCost: number;
  /** Signed change in inventory value. */
  value: number;
}

/** What a new standard cost would do to the stock already on hand; null when nothing changes. */
export function pendingRevaluation(item: Pick<Item, "id" | "sku" | "unit" | "onHand" | "unitCost">, toCost: number): PendingRevaluation | null {
  const qty = Math.max(0, item.onHand);
  if (qty <= 0 || Math.abs(toCost - item.unitCost) < 0.00005) return null;
  const value = round(qty * (toCost - item.unitCost), 2);
  if (value === 0) return null;
  return { item: { id: item.id, sku: item.sku, unit: item.unit }, qty, fromCost: item.unitCost, toCost, value };
}

/**
 * The revaluations a delivery would post under standard costing when it updates standard cost:
 * the lines are played in order, as receiveStock books them, so a second line of the same part
 * revalues what the first one brought in. One entry per item, summed.
 */
export function receiptRevaluations(items: ReadonlyMap<string, Item>, lines: ReadonlyArray<{ itemId: string; qty: number; unitCost?: number }>): PendingRevaluation[] {
  const state = new Map<string, { onHand: number; unitCost: number }>();
  const out = new Map<string, PendingRevaluation>();
  for (const line of lines) {
    const item = items.get(line.itemId);
    if (!item) continue;
    const s = state.get(item.id) ?? { onHand: item.onHand, unitCost: item.unitCost };
    const toCost = line.unitCost ?? s.unitCost;
    const r = pendingRevaluation({ ...item, onHand: s.onHand, unitCost: s.unitCost }, toCost);
    if (r) {
      const prev = out.get(item.id);
      out.set(item.id, prev ? { ...prev, toCost, value: round(prev.value + r.value, 2) } : r);
    }
    state.set(item.id, { onHand: round(Math.max(0, s.onHand) + line.qty, 3), unitCost: toCost });
  }
  return Array.from(out.values()).filter((r) => r.value !== 0);
}

/** One line a person can read: "200 ft of TUBE-1 from $0.00 to $7.50 (+$1,500.00)". */
export function describeRevaluation(r: PendingRevaluation, currency: string): string {
  const sign = r.value > 0 ? "+" : "−";
  return `${r.qty} ${r.item.unit} of ${r.item.sku} from ${formatMoney(r.fromCost, currency)} to ${formatMoney(r.toCost, currency)} (${sign}${formatMoney(Math.abs(r.value), currency)})`;
}

/** The ledger movement and Activity entry for a revaluation. */
export function revaluationOps(actor: Actor, r: PendingRevaluation, ctx: { currency: string; occurredAt?: string; refType?: RefType; refId?: string; reason: string }): WriteOp[] {
  const now = nowIso();
  const movement: StockMovement = {
    id: newId("mv"),
    itemId: r.item.id,
    type: "revaluation",
    qty: 0,
    unitCost: r.toCost,
    previousUnitCost: r.fromCost,
    valueChange: r.value,
    refType: ctx.refType,
    refId: ctx.refId,
    reason: ctx.reason,
    balanceAfter: r.qty,
    occurredAt: ctx.occurredAt ?? now,
    createdAt: now,
    createdBy: actor.id,
  };
  return [
    { op: "put", collection: "movements", doc: movement },
    activityOp(actor, "item.revalued", `${actor.name} revalued ${describeRevaluation(r, ctx.currency)} · ${ctx.reason}`, {
      entityType: "item",
      entityId: r.item.id,
      meta: { qty: r.qty, fromCost: r.fromCost, toCost: r.toCost, value: r.value, reason: ctx.reason },
    }),
  ];
}
