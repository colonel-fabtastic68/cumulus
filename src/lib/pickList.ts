import type { BomSelection, Item, Location, SalesOrder } from "@/lib/types";
import { defaultLocation, explodeBom, openQty, qtyAt, routedLocation } from "@/lib/inventory";
import { escapeHtml, openPrintWindow } from "@/lib/print";
import { formatDateTime } from "@/lib/format";
import { round } from "@/lib/utils";
import { describeQty } from "@/lib/units";

/**
 * Pick lists: what to pull, from where, in the order you walk the shelves.
 *
 * - For a sales order: every open line at the location it ships from (the
 *   line's own location, else the part's fulfillment location, else the
 *   default), with its bin. An assembly marked "pick as parts" (or every
 *   assembly, when asked) is broken out to its components, because it leaves
 *   as a kit of parts rather than a built unit.
 * - For a BOM: the components for a quantity of an assembly, for the bench.
 *
 * Lines for the same part at the same location are combined, then sorted by
 * location, bin and part number.
 */

export interface PickLine {
  item: Item;
  /** Quantity to pull, in the item's stocking unit. */
  qty: number;
  locationId: string;
  locationName: string;
  bin?: string;
  /** On hand at that location right now. */
  available: number;
  /** How much of qty the location cannot cover. */
  short: number;
  /** The assemblies this part is being pulled for, when it was broken out of one. */
  forSkus: string[];
  /** As typed on the order when the line was entered in another unit ("2 case"). */
  entered?: string;
}

export interface PickContext {
  items: Item[];
  locations: Location[];
}

function binAt(item: Item, locationId: string, homeId: string): string | undefined {
  if (item.stock) return item.stock[locationId]?.bin || undefined;
  return locationId === homeId ? item.location || undefined : undefined;
}

/** Bins sort the way they read on the shelf: A2 before A10. */
function compareBins(a?: string, b?: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

class PickBuilder {
  private lines = new Map<string, PickLine>();
  readonly homeId: string;
  private homeName: string;

  constructor(private ctx: PickContext) {
    const home = defaultLocation(ctx.locations).location;
    this.homeId = home.id;
    this.homeName = home.name;
  }

  locationName(id: string): string {
    return id === this.homeId ? this.homeName : (this.ctx.locations.find((l) => l.id === id)?.name ?? id);
  }

  /** Where a part is pulled from: the place asked for, when it is still a usable location, else the part's routing, else the default. */
  locationFor(item: Item, preferred?: string): string {
    if (preferred && (preferred === this.homeId || this.ctx.locations.some((l) => l.id === preferred && l.active))) return preferred;
    return routedLocation("fulfill", item, this.ctx.locations)?.id ?? this.homeId;
  }

  add(item: Item, qty: number, locationId: string, extra: { forSku?: string; entered?: string } = {}) {
    if (qty <= 0) return;
    const key = `${item.id}@${locationId}`;
    const existing = this.lines.get(key);
    const total = round((existing?.qty ?? 0) + qty, 3);
    const available = qtyAt(item, locationId, this.homeId);
    this.lines.set(key, {
      item,
      qty: total,
      locationId,
      locationName: this.locationName(locationId),
      bin: binAt(item, locationId, this.homeId),
      available,
      short: round(Math.max(0, total - Math.max(0, available)), 3),
      forSkus: extra.forSku ? Array.from(new Set([...(existing?.forSkus ?? []), extra.forSku])) : (existing?.forSkus ?? []),
      // Two lines for one part no longer read as a single typed quantity.
      entered: existing ? undefined : extra.entered,
    });
  }

  result(): PickLine[] {
    return Array.from(this.lines.values()).sort(
      (a, b) =>
        Number(b.locationId === this.homeId) - Number(a.locationId === this.homeId) ||
        a.locationName.localeCompare(b.locationName) ||
        compareBins(a.bin, b.bin) ||
        a.item.sku.localeCompare(b.item.sku, "en", { numeric: true }),
    );
  }
}

export interface OrderPickOptions {
  /** Break every assembly on the order out to its parts, not only the ones marked "pick as parts". */
  breakOutAssemblies?: boolean;
}

/** What is still to pull for a sales order. */
export function orderPickList(order: SalesOrder, ctx: PickContext, opts: OrderPickOptions = {}): PickLine[] {
  const byId = new Map(ctx.items.map((i) => [i.id, i]));
  const b = new PickBuilder(ctx);
  for (const line of order.lines) {
    const item = byId.get(line.itemId);
    const qty = openQty(line);
    if (!item || qty <= 0) continue;
    const locationId = b.locationFor(item, line.locationId);
    const asParts = item.type === "assembly" && item.bom.length > 0 && (opts.breakOutAssemblies || item.pickAsParts);
    if (asParts) {
      // Each component comes from its own fulfillment location; a location set on the line applies to all of them.
      for (const r of explodeBom(ctx.items, item, qty, { consumeSubassemblies: true })) b.add(r.item, r.required, b.locationFor(r.item, line.locationId), { forSku: item.sku });
    } else {
      b.add(item, qty, locationId, { entered: line.entered ? describeQty(item, qty, line.entered) : undefined });
    }
  }
  return b.result();
}

export interface BomPickOptions {
  locationId?: string;
  selection?: BomSelection;
  /** False breaks sub-assemblies out to their own parts instead of pulling them built. */
  consumeSubassemblies?: boolean;
}

/** The components to pull to build `qty` of an assembly. */
export function bomPickList(assembly: Item, qty: number, ctx: PickContext, opts: BomPickOptions = {}): PickLine[] {
  const b = new PickBuilder(ctx);
  const consumeSub = opts.consumeSubassemblies ?? true;
  for (const r of explodeBom(ctx.items, assembly, qty, { consumeSubassemblies: consumeSub, selection: opts.selection })) b.add(r.item, r.required, opts.locationId ?? b.homeId, { forSku: assembly.sku });
  return b.result();
}

export function pickListShort(lines: PickLine[]): PickLine[] {
  return lines.filter((l) => l.short > 0);
}

export interface PickSheet {
  title: string;
  /** Under the title: who it is for, the order or build it belongs to. */
  subtitle: string;
  companyName: string;
  /** Column header for the item code ("SKU", "PN"). */
  itemCodeLabel?: string;
  lines: PickLine[];
  note?: string;
  /** Ship-to block for order pick lists. */
  shipTo?: string[];
}

/** The printable sheet: one table per location, a tick box and a "picked" blank per line. */
export function pickSheetHtml(sheet: PickSheet): string {
  const code = escapeHtml(sheet.itemCodeLabel ?? "SKU");
  const groups = new Map<string, PickLine[]>();
  for (const l of sheet.lines) groups.set(l.locationName, [...(groups.get(l.locationName) ?? []), l]);
  const many = groups.size > 1;
  let n = 0;
  const tables = Array.from(groups, ([location, lines]) => {
    const rows = lines
      .map((l) => {
        n += 1;
        const qty = `${round(l.qty, 3)}${l.item.unit && l.item.unit !== "ea" ? ` ${escapeHtml(l.item.unit)}` : ""}`;
        const detail = [l.entered ? escapeHtml(l.entered) : "", l.forSkus.length ? `for ${escapeHtml(l.forSkus.join(", "))}` : "", l.short > 0 ? `<strong>short ${round(l.short, 3)}</strong> (${round(l.available, 3)} here)` : ""].filter(Boolean).join(" · ");
        return `<tr><td class="n">${n}</td><td><span class="box"></span></td><td class="mono bin">${escapeHtml(l.bin ?? "")}</td><td class="mono">${escapeHtml(l.item.sku)}</td><td>${escapeHtml(l.item.name)}${detail ? `<div class="muted">${detail}</div>` : ""}</td><td class="n qty">${qty}</td><td class="n"><span class="blank"></span></td></tr>`;
      })
      .join("");
    return `${many ? `<h2>${escapeHtml(location)}</h2>` : ""}<table><thead><tr><th class="n">#</th><th>Picked</th><th>Bin</th><th>${code}</th><th>Item</th><th class="n">Qty</th><th class="n">Pulled</th></tr></thead><tbody>${rows}</tbody></table>`;
  }).join("");
  const units = round(sheet.lines.reduce((a, l) => a + l.qty, 0), 3);
  const short = pickListShort(sheet.lines).length;
  const only = !many && sheet.lines[0] ? ` · ${escapeHtml(sheet.lines[0].locationName)}` : "";
  const head = `<h1>${escapeHtml(sheet.title)}</h1><div class="muted">${escapeHtml(sheet.companyName)} · ${escapeHtml(sheet.subtitle)}${only} · ${sheet.lines.length} ${sheet.lines.length === 1 ? "line" : "lines"}, ${units} units${short ? ` · ${short} short` : ""} · printed ${escapeHtml(formatDateTime(new Date().toISOString()))}</div>
${sheet.shipTo?.length ? `<div style="margin-top:10px"><strong>Ship to</strong><br>${sheet.shipTo.map(escapeHtml).join("<br>")}</div>` : ""}
<div style="margin-top:10px">Picked by: <span class="blank" style="min-width:180px"></span> &nbsp; Date: <span class="blank" style="min-width:120px"></span></div>`;
  const foot = sheet.note ? `<p style="margin-top:14px;white-space:pre-line"><strong>Note</strong><br>${escapeHtml(sheet.note)}</p>` : "";
  return head + tables + foot;
}

const PICK_CSS = "h2{font-size:13px;margin:18px 0 0}.box{width:18px;height:18px}.bin{font-size:13px;font-weight:600;white-space:nowrap}.qty{font-size:14px;font-weight:600}";

/** Opens the pick sheet in a print view. False when pop-ups are blocked. */
export function printPickSheet(sheet: PickSheet): boolean {
  return openPrintWindow(sheet.title, pickSheetHtml(sheet), PICK_CSS);
}
