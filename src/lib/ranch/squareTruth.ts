import type { Item, Lot } from "@/lib/types";
import type { SquareCatalogObject, SquareInventoryChange, SquareVariationObject } from "@/lib/integrations/square";

/**
 * cumulusOS as the source of truth on a ranch instance ("cumulus" mode),
 * free of I/O so it can be checked against real catalogs.
 *
 * Animals are received and recounted in cumulusOS; Square's counts per
 * "Lot #" variation are set from here. The counter still sells in Square, so
 * Square's history is read change by change: counter sales and refunds come
 * in as sales and returns on the same lot, and anything else done to a count
 * in Square (a recount, a manual edit, another app) is reported and then put
 * back to the number cumulusOS holds.
 *
 * "square" mode is the original route A, where Square holds the counts and
 * cumulusOS mirrors them (squareMirror.ts).
 */

export type RanchMode = "square" | "cumulus";

export function ranchModeOf(config: Record<string, string> | undefined): RanchMode {
  return config?.ranchMode === "cumulus" ? "cumulus" : "square";
}

/** reference_id on every count and adjustment cumulusOS writes to Square, so the history reader skips its own writes. */
export const OUR_REFERENCE = "cumulusOS";

export function isOurReference(ref: string | undefined): boolean {
  // "Web order …" is what web-sale adjustments were labelled before the prefix existed.
  return !!ref && (ref.startsWith(OUR_REFERENCE) || ref.startsWith("Web order "));
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function roundTo(n: number, places: number): number {
  const f = 10 ** Math.max(0, Math.min(5, places));
  return Math.round(n * f) / f;
}

/** A Square change worth acting on. */
export interface SquareEvent {
  /** Square's id for the change; each is applied once. */
  id: string;
  /** sale/return: the counter sold or refunded pounds. elsewhere: a count changed in Square some other way. */
  kind: "sale" | "return" | "elsewhere";
  variationId: string;
  /** Pounds sold or returned; for "elsewhere", the signed effect on the count when Square says (0 for a recount). */
  qty: number;
  occurredAt: string;
  /** Who made it, in words: "Square POS", "Square Dashboard", the other app's name… */
  via: string;
  /** For "elsewhere": what happened, e.g. "recounted to 12" or "IN_STOCK → WASTE". */
  detail?: string;
}

function viaOf(source: { product?: string; name?: string } | undefined): string {
  switch (source?.product) {
    case "SQUARE_POS":
      return "Square POS";
    case "DASHBOARD":
      return "Square Dashboard";
    case "ONLINE_STORE":
      return "Square Online";
    case "INVOICES":
      return "Square Invoices";
    case "ITEM_LIBRARY_IMPORT":
      return "a Square catalog import";
    case "EXTERNAL_API":
      return source?.name?.trim() || "another app";
    case undefined:
      return "Square";
    default:
      return (source?.product ?? "Square").toLowerCase().replace(/_/g, " ");
  }
}

/**
 * Turns Square's history at one location into events, skipping cumulusOS's own
 * writes and the adjustments a recount generates (the recount itself is reported).
 * `latest` is the newest created_at seen, so the next read can start from there.
 */
export function readSquareHistory(changes: SquareInventoryChange[], locationId: string): { events: SquareEvent[]; latest?: string } {
  const events: SquareEvent[] = [];
  let latest: string | undefined;
  const seen = (at?: string) => {
    if (at && (!latest || at > latest)) latest = at;
  };
  for (const c of changes) {
    if (c.type === "PHYSICAL_COUNT" && c.physical_count) {
      const pc = c.physical_count;
      seen(pc.created_at);
      if (!pc.catalog_object_id || (pc.location_id && pc.location_id !== locationId) || isOurReference(pc.reference_id)) continue;
      if (pc.state && pc.state !== "IN_STOCK") continue;
      events.push({ id: pc.id, kind: "elsewhere", variationId: pc.catalog_object_id, qty: 0, occurredAt: pc.occurred_at ?? pc.created_at ?? "", via: viaOf(pc.source), detail: `recounted to ${Number(pc.quantity ?? 0)}` });
      continue;
    }
    if (c.type !== "ADJUSTMENT" || !c.adjustment) continue;
    const a = c.adjustment;
    seen(a.created_at);
    const loc = a.from_location_id ?? a.to_location_id ?? a.location_id;
    if (!a.catalog_object_id || (loc && loc !== locationId) || isOurReference(a.reference_id) || a.physical_count_id) continue;
    const qty = Number(a.quantity ?? 0);
    if (!(qty > 0)) continue;
    const base = { id: a.id, variationId: a.catalog_object_id, occurredAt: a.occurred_at ?? a.created_at ?? "", via: viaOf(a.source) };
    // Another app selling through Square (a store plugin left syncing inventory, say) is not a counter sale:
    // the store's orders already arrive from WooCommerce, so counting them again would sell the pounds twice.
    const fromOtherApp = a.source?.product === "EXTERNAL_API";
    if (a.from_state === "IN_STOCK" && a.to_state === "SOLD" && !fromOtherApp) {
      events.push({ ...base, kind: "sale", qty: round3(qty) });
    } else if (a.to_state === "IN_STOCK" && a.from_state !== "IN_STOCK" && (a.refund_id || a.from_state === "SOLD") && !fromOtherApp) {
      events.push({ ...base, kind: "return", qty: round3(qty) });
    } else {
      const effect = a.to_state === "IN_STOCK" ? qty : a.from_state === "IN_STOCK" ? -qty : 0;
      events.push({ ...base, kind: "elsewhere", qty: round3(effect), detail: `${a.from_state ?? "?"} → ${a.to_state ?? "?"}` });
    }
  }
  return { events, latest };
}

export interface ImportPlan {
  /** Pounds to take out of a lot; `short` is what the counter sold beyond what the lot held here. */
  sales: Array<{ eventId: string; lotId: string; itemId: string; qty: number; short: number; occurredAt: string; via: string }>;
  returns: Array<{ eventId: string; lotId: string; itemId: string; qty: number; occurredAt: string; via: string }>;
  /** Changes made in Square that the next count push puts back. */
  elsewhere: Array<SquareEvent & { lotId?: string }>;
  /** Events on variations no lot here follows (items left out, or added in Square). */
  unlinked: SquareEvent[];
}

/** Applies counter sales and refunds to the lots they name, in order, never taking a lot below zero. */
export function planSquareImport(events: SquareEvent[], lots: Lot[]): ImportPlan {
  const byVariation = new Map(lots.filter((l) => l.externalIds?.square).map((l) => [l.externalIds!.square!, l]));
  const remaining = new Map(lots.map((l) => [l.id, l.qtyRemaining]));
  const plan: ImportPlan = { sales: [], returns: [], elsewhere: [], unlinked: [] };
  for (const e of [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))) {
    const lot = byVariation.get(e.variationId);
    if (!lot) {
      plan.unlinked.push(e);
      continue;
    }
    const have = remaining.get(lot.id) ?? 0;
    if (e.kind === "sale") {
      const take = round3(Math.min(Math.max(0, have), e.qty));
      remaining.set(lot.id, round3(have - take));
      plan.sales.push({ eventId: e.id, lotId: lot.id, itemId: lot.itemId, qty: take, short: round3(e.qty - take), occurredAt: e.occurredAt, via: e.via });
    } else if (e.kind === "return") {
      remaining.set(lot.id, round3(have + e.qty));
      plan.returns.push({ eventId: e.id, lotId: lot.id, itemId: lot.itemId, qty: e.qty, occurredAt: e.occurredAt, via: e.via });
    } else plan.elsewhere.push({ ...e, lotId: lot.id });
  }
  return plan;
}

/** Decimal places Square keeps for each variation's unit (Willo Ranch's "Pound 1.00" is 2), from the catalog. */
export function variationPrecision(objects: SquareCatalogObject[]): Map<string, number> {
  const units = new Map(objects.filter((o) => o.type === "MEASUREMENT_UNIT").map((o) => [o.id, o.measurement_unit_data?.precision ?? 2]));
  const out = new Map<string, number>();
  for (const o of objects) {
    for (const v of o.item_data?.variations ?? []) {
      const unit = v.item_variation_data?.measurement_unit_id;
      out.set(v.id, unit ? (units.get(unit) ?? 2) : 0);
    }
  }
  return out;
}

export interface CountPush {
  lotId: string;
  variationId: string;
  /** What Square shows now. */
  from: number;
  /** What cumulusOS holds, at Square's precision. */
  to: number;
}

/** The counts to set in Square so every linked lot reads what cumulusOS holds (all lots, or the ones named). */
export function planCountPush(lots: Lot[], squareCounts: Map<string, number>, precision: Map<string, number>, only?: Set<string>): CountPush[] {
  const out: CountPush[] = [];
  for (const lot of lots) {
    const v = lot.externalIds?.square;
    if (!v || (only && !only.has(lot.id))) continue;
    const places = precision.get(v) ?? 2;
    const to = roundTo(Math.max(0, lot.qtyRemaining), places);
    const from = squareCounts.get(v) ?? 0;
    if (Math.abs(from - to) >= 0.5 / 10 ** places) out.push({ lotId: lot.id, variationId: v, from, to });
  }
  return out;
}

export interface VariationPlan {
  /** ITEM_OPTION_VAL and ITEM_VARIATION objects for one catalog/batch-upsert, cross-referenced by "#" ids. */
  objects: Array<Record<string, unknown>>;
  /** Each lot's Square variation: an existing one with the same animal, or the "#" id of a new one. */
  links: Array<{ lotId: string; variationId?: string; clientId?: string }>;
  problems: string[];
}

const normal = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The variation a new one copies its price, unit and locations from: the item's newest live variation. */
function templateOf(item: SquareCatalogObject): SquareVariationObject | undefined {
  return [...(item.item_data?.variations ?? [])].filter((v) => !v.is_deleted).sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0];
}

/**
 * Square variations for lots received here (one animal's share of a cut). Each
 * becomes a "Lot #" value on the cut's Square item, priced like the item's
 * newest variation, so the counter can sell it straight away. An animal Square
 * already lists on that cut is reused rather than duplicated.
 */
export function planNewVariations(lots: Lot[], items: Map<string, Pick<Item, "id" | "name" | "externalIds">>, catalog: SquareCatalogObject[], linkedVariationIds: Set<string>): VariationPlan {
  const plan: VariationPlan = { objects: [], links: [], problems: [] };
  const byId = new Map(catalog.filter((o) => !o.is_deleted).map((o) => [o.id, o]));
  const newValues = new Map<string, string>();
  for (const lot of lots) {
    const item = items.get(lot.itemId);
    const label = (lot.supplierLot ?? "").trim() || lot.number || lot.id;
    const squareItemId = item?.externalIds?.square;
    const sq = squareItemId ? byId.get(squareItemId) : undefined;
    if (!item || !sq || sq.type !== "ITEM") {
      plan.problems.push(`${item?.name ?? "A cut"} (${label}) is not on a Square item, so the counter cannot sell it.`);
      continue;
    }
    const existing = (sq.item_data?.variations ?? []).find((v) => !v.is_deleted && normal(v.item_variation_data?.name ?? "") === normal(label));
    if (existing) {
      if (linkedVariationIds.has(existing.id)) plan.problems.push(`${item.name} already has animal ${label} in another lot; combine the two lots.`);
      else plan.links.push({ lotId: lot.id, variationId: existing.id });
      continue;
    }
    const template = templateOf(sq);
    const t = template?.item_variation_data ?? {};
    const optionId = sq.item_data?.item_options?.[0]?.item_option_id;
    let valueId: string | undefined;
    if (optionId) {
      const option = byId.get(optionId);
      valueId = option?.item_option_data?.values?.find((v) => !v.is_deleted && normal(v.item_option_value_data?.name ?? "") === normal(label))?.id;
      if (!valueId) {
        const key = `${optionId}|${normal(label)}`;
        valueId = newValues.get(key);
        if (!valueId) {
          valueId = `#val-${newValues.size + 1}`;
          newValues.set(key, valueId);
          plan.objects.push({ type: "ITEM_OPTION_VAL", id: valueId, item_option_value_data: { item_option_id: optionId, name: label } });
        }
      }
    }
    const clientId = `#var-${lot.id}`;
    plan.objects.push({
      type: "ITEM_VARIATION",
      id: clientId,
      ...(template?.present_at_all_locations !== undefined ? { present_at_all_locations: template.present_at_all_locations } : {}),
      ...(template?.present_at_location_ids?.length ? { present_at_location_ids: template.present_at_location_ids } : {}),
      ...(template?.absent_at_location_ids?.length ? { absent_at_location_ids: template.absent_at_location_ids } : {}),
      item_variation_data: {
        item_id: sq.id,
        name: label,
        pricing_type: t.pricing_type ?? (t.price_money?.amount !== undefined ? "FIXED_PRICING" : "VARIABLE_PRICING"),
        ...(t.price_money?.amount !== undefined ? { price_money: { amount: t.price_money.amount, currency: t.price_money.currency ?? "USD" } } : {}),
        ...(t.measurement_unit_id ? { measurement_unit_id: t.measurement_unit_id } : {}),
        track_inventory: true,
        sellable: true,
        stockable: true,
        ...(optionId && valueId ? { item_option_values: [{ item_option_id: optionId, item_option_value_id: valueId }] } : {}),
      },
    });
    plan.links.push({ lotId: lot.id, clientId });
  }
  return plan;
}

/** One line for a sync: "2 counter sales (3.4 lb), 1 change in Square put back, 3 counts set". */
export function describeSquareSync(r: { sales: number; salesLb: number; returns: number; elsewhere: number; counts: number; created: number; adopted?: number; short: number }): string {
  const parts = [
    r.sales ? `${r.sales} counter sale${r.sales === 1 ? "" : "s"} (${round3(r.salesLb)} lb)` : "",
    r.returns ? `${r.returns} counter refund${r.returns === 1 ? "" : "s"}` : "",
    r.short ? `${r.short} oversold at the counter` : "",
    r.elsewhere ? `${r.elsewhere} change${r.elsewhere === 1 ? "" : "s"} made in Square put back` : "",
    r.created ? `${r.created} animal cut${r.created === 1 ? "" : "s"} added to Square` : "",
    r.adopted ? `${r.adopted} animal cut${r.adopted === 1 ? "" : "s"} added in Square brought in` : "",
    r.counts ? `${r.counts} Square count${r.counts === 1 ? "" : "s"} set` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "Square matches";
}
