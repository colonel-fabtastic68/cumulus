import type { BadgeTone } from "@/components/ui";
import type { Item, Lot, MovementType, RefType, StockMovement } from "@/lib/types";
import { round } from "@/lib/utils";

const DAY = 86_400_000;

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  receipt: "Receipt",
  adjustment: "Adjustment",
  count: "Count",
  write_off: "Write-off",
  build_consume: "Build consume",
  build_produce: "Build produce",
  sale: "Sale",
  rma_return: "RMA return",
  import: "Import",
};

export const MOVEMENT_TYPES = Object.keys(MOVEMENT_LABELS) as MovementType[];

export const REF_LABELS: Record<RefType, string> = {
  receipt: "Receipt",
  build: "Build",
  order: "Order",
  rma: "RMA",
  import: "Import",
  agent: "Agent",
  manual: "Manual",
};

export function movementTone(type: MovementType): BadgeTone {
  switch (type) {
    case "receipt":
    case "build_produce":
    case "rma_return":
      return "success";
    case "sale":
    case "build_consume":
      return "info";
    case "write_off":
      return "critical";
    default:
      return "default";
  }
}

/** A movement recorded more than a day after its effective date. */
export function isBackDated(m: StockMovement): boolean {
  return new Date(m.createdAt).getTime() - new Date(m.occurredAt).getTime() > DAY;
}

/**
 * Link for a ledger reference. Detail routes belong to other packages, so we
 * link to the list page and pass the id as `?highlight=` (the convention the
 * dashboard already uses) so the list can open the document.
 */
export function refHref(refType: RefType | undefined, refId?: string): string | null {
  const base = (() => {
    switch (refType) {
      case "receipt":
        return "/receiving";
      case "build":
        return "/builds";
      case "order":
        return "/orders";
      case "rma":
        return "/rmas";
      default:
        return null;
    }
  })();
  if (!base) return null;
  return refId ? `${base}?highlight=${encodeURIComponent(refId)}` : base;
}

export function itemHref(itemId: string): string {
  return "/inventory/" + itemId;
}

export function supplierHref(supplierId: string): string {
  return "/suppliers?highlight=" + encodeURIComponent(supplierId);
}

export interface WeekBucket {
  start: string;
  label: string;
  inQty: number;
  outQty: number;
}

/** Units in vs out per rolling 7-day window, oldest first, by effective date. */
export function weeklyBuckets(movements: StockMovement[], weeks = 12): WeekBucket[] {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
  const first = end - weeks * 7 * DAY;
  const buckets: WeekBucket[] = [];
  for (let i = 0; i < weeks; i++) {
    const start = new Date(first + i * 7 * DAY);
    buckets.push({
      start: start.toISOString(),
      label: start.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      inQty: 0,
      outQty: 0,
    });
  }
  for (const m of movements) {
    const t = new Date(m.occurredAt).getTime();
    if (!Number.isFinite(t) || t < first || t >= end) continue;
    const b = buckets[Math.min(weeks - 1, Math.floor((t - first) / (7 * DAY)))]!;
    if (m.qty > 0) b.inQty = round(b.inQty + m.qty, 3);
    else b.outQty = round(b.outQty - m.qty, 3);
  }
  return buckets;
}

/** Quantity-weighted average cost of the batches still on the shelf. */
export function weightedAverageCost(lots: Lot[], fallback: number): { cost: number; fromLots: boolean } {
  let qty = 0;
  let value = 0;
  for (const l of lots) {
    if (l.qtyRemaining <= 0) continue;
    qty += l.qtyRemaining;
    value += l.qtyRemaining * l.unitCost;
  }
  if (qty <= 0) return { cost: fallback, fromLots: false };
  return { cost: round(value / qty, 4), fromLots: true };
}

/** Batches older than this many days are flagged on the Batches tab. */
export const OLD_BATCH_DAYS = 180;

/** Fields copied when duplicating an item. SKU, quantities, audit fields and supersession are left out. */
export function duplicateDefaults(item: Item): Partial<Item> {
  return {
    name: `${item.name} (copy)`,
    description: item.description,
    type: item.type,
    category: item.category,
    tags: [...item.tags],
    unit: item.unit,
    status: "active",
    minQty: item.minQty,
    maxQty: item.maxQty,
    leadTimeDays: item.leadTimeDays,
    unitCost: item.unitCost,
    price: item.price,
    salePrice: item.salePrice,
    priceBreaks: item.priceBreaks ? item.priceBreaks.map((b) => ({ ...b })) : undefined,
    supplierId: item.supplierId,
    supplierSku: item.supplierSku,
    location: item.location,
    expectedWastePct: item.expectedWastePct,
  };
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
