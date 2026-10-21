import type { Item, Location, Lot, Supplier } from "@/lib/types";
import { findItemByCode, normalizeCode, type CodeMatch } from "@/lib/scan";
import { locationKindLabel } from "@/lib/locations";
import type { EncodeMode, LabelKind, LabelSpec, Symbology } from "./spec";

/** One label's worth of data, whatever the record behind it. */
export interface LabelEntry {
  id: string;
  kind: LabelKind;
  /** What a plain barcode carries: the SKU, the location code, the lot number. */
  code: string;
  /** The item's GTIN / UPC / PLU, for EAN-13 and UPC-A. */
  gtin?: string;
  title: string;
  subtitle?: string;
  detail?: string;
  price?: number;
  /** In-app path the QR link opens. */
  href: string;
}

export interface LabelData {
  items: Item[];
  locations: Location[];
  suppliers: Supplier[];
  lots: Lot[];
}

/** The prefix a scan carries so the app knows which kind of record to look up. */
const PREFIX: Record<LabelKind, string> = { item: "sku", assembly: "sku", location: "loc", supplier: "sup", lot: "lot" };

export function itemEntry(item: Item, kind: LabelKind = item.type === "assembly" ? "assembly" : "item"): LabelEntry {
  const detail = [item.category, item.location ? `Bin ${item.location}` : null].filter(Boolean).join(" · ");
  return { id: item.id, kind, code: item.sku, gtin: item.barcode?.replace(/\s+/g, "") || undefined, title: item.name, subtitle: item.sku, detail: detail || undefined, price: item.price, href: `/inventory/${item.id}` };
}

export function locationEntry(loc: Location): LabelEntry {
  return { id: loc.id, kind: "location", code: loc.code?.trim() || loc.id, title: loc.name, subtitle: loc.code?.trim() || undefined, detail: locationKindLabel(loc.kind), href: `/transfers?location=${encodeURIComponent(loc.id)}` };
}

export function supplierEntry(s: Supplier): LabelEntry {
  const detail = [s.leadTimeDays ? `${s.leadTimeDays}-day lead time` : null, s.phone || s.email || null].filter(Boolean).join(" · ");
  return { id: s.id, kind: "supplier", code: s.id, title: s.name, detail: detail || undefined, href: `/suppliers?highlight=${encodeURIComponent(s.id)}` };
}

export function lotEntry(lot: Lot, item: Item | undefined): LabelEntry {
  const number = lot.number ?? lot.id;
  const detail = [item?.sku, lot.supplierLot ? `Supplier lot ${lot.supplierLot}` : null, lot.expiresAt ? `Exp ${lot.expiresAt.slice(0, 10)}` : null].filter(Boolean).join(" · ");
  return { id: lot.id, kind: "lot", code: number, title: item?.name ?? number, subtitle: number, detail: detail || undefined, href: item ? `/inventory/${item.id}?tab=batches` : "/inventory" };
}

/** Every entry of a kind, in a stable order, optionally narrowed to ids. */
export function entriesFor(kind: LabelKind, data: LabelData, ids?: Set<string>): LabelEntry[] {
  const keep = (id: string) => !ids || ids.has(id);
  switch (kind) {
    case "item":
      return data.items.filter((i) => i.status !== "superseded" && keep(i.id)).sort((a, b) => a.sku.localeCompare(b.sku)).map((i) => itemEntry(i, "item"));
    case "assembly":
      return data.items.filter((i) => i.type === "assembly" && i.status !== "superseded" && keep(i.id)).sort((a, b) => a.sku.localeCompare(b.sku)).map((i) => itemEntry(i, "assembly"));
    case "location":
      return data.locations.filter((l) => l.active && keep(l.id)).sort((a, b) => a.name.localeCompare(b.name)).map(locationEntry);
    case "supplier":
      return data.suppliers.filter((s) => keep(s.id)).sort((a, b) => a.name.localeCompare(b.name)).map(supplierEntry);
    case "lot": {
      const byId = new Map(data.items.map((i) => [i.id, i]));
      return data.lots.filter((l) => l.qtyRemaining > 0 && keep(l.id)).sort((a, b) => (a.number ?? a.id).localeCompare(b.number ?? b.id)).map((l) => lotEntry(l, byId.get(l.itemId)));
    }
  }
}

/** The in-app path a QR code opens: the scan page resolves the prefixed code and forwards to the record. */
export function scanPath(entry: LabelEntry): string {
  return `/scan?c=${encodeURIComponent(`${PREFIX[entry.kind]}:${entry.code}`)}`;
}

/** The text the bars or squares carry. Retail symbologies take the item's GTIN; links need the app's origin. */
export function encodedText(entry: LabelEntry, encode: EncodeMode, symbology: Symbology, origin: string): string {
  if (symbology === "ean13" || symbology === "upca") return entry.gtin ?? entry.code;
  if (encode === "link") return `${origin.replace(/\/$/, "")}${scanPath(entry)}`;
  return entry.code;
}

export function encodedTextFor(entry: LabelEntry, spec: Pick<LabelSpec, "encode" | "symbology">, origin: string): string {
  return encodedText(entry, spec.encode, spec.symbology, origin);
}

// ---- Reading a code back --------------------------------------------------------------

export interface ScanResolution {
  kind: LabelKind;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  /** Item hits carry the item and how it matched (barcode, SKU, cross-reference). */
  item?: Item;
  match?: CodeMatch;
  lot?: Lot;
  location?: Location;
  supplier?: Supplier;
}

/** Splits a scanned string into an optional kind prefix and the code; accepts the app's own scan links. */
export function parseScanCode(raw: string): { prefix?: string; code: string } {
  let s = normalizeCode(raw);
  const url = /^https?:\/\//i.test(s) ? s : null;
  if (url) {
    try {
      const u = new URL(url);
      const c = u.searchParams.get("c");
      if (c) s = c;
    } catch {
      // not a URL after all
    }
  }
  const m = /^(sku|loc|sup|lot):(.+)$/i.exec(s);
  if (m) return { prefix: m[1]!.toLowerCase(), code: m[2]!.trim() };
  return { code: s };
}

const eq = (a: string | undefined, b: string) => !!a && a.trim().toLowerCase() === b.toLowerCase();

/** Which record a scanned code belongs to: items first, then batches, locations and suppliers, unless the code says. */
export function resolveScan(raw: string, data: LabelData): ScanResolution | null {
  const { prefix, code } = parseScanCode(raw);
  if (!code) return null;
  const byId = new Map(data.items.map((i) => [i.id, i]));

  const item = (): ScanResolution | null => {
    const match = findItemByCode(data.items, code) ?? (byId.has(code) ? { item: byId.get(code)!, matchedBy: "sku" as const } : null);
    if (!match) return null;
    const e = itemEntry(match.item);
    return { kind: e.kind, id: e.id, title: e.title, subtitle: e.subtitle, href: e.href, item: match.item, match };
  };
  const lot = (): ScanResolution | null => {
    const l = data.lots.find((x) => eq(x.number, code) || x.id === code) ?? data.lots.find((x) => eq(x.supplierLot, code));
    if (!l) return null;
    const e = lotEntry(l, byId.get(l.itemId));
    return { kind: "lot", id: l.id, title: e.title, subtitle: e.subtitle, href: e.href, lot: l, item: byId.get(l.itemId) };
  };
  const location = (): ScanResolution | null => {
    const l = data.locations.find((x) => eq(x.code, code) || x.id === code) ?? data.locations.find((x) => eq(x.name, code));
    if (!l) return null;
    const e = locationEntry(l);
    return { kind: "location", id: l.id, title: e.title, subtitle: e.detail, href: e.href, location: l };
  };
  const supplier = (): ScanResolution | null => {
    const s = data.suppliers.find((x) => x.id === code) ?? data.suppliers.find((x) => eq(x.name, code));
    if (!s) return null;
    const e = supplierEntry(s);
    return { kind: "supplier", id: s.id, title: e.title, subtitle: e.subtitle, href: e.href, supplier: s };
  };

  switch (prefix) {
    case "sku":
      return item();
    case "lot":
      return lot();
    case "loc":
      return location();
    case "sup":
      return supplier();
    default:
      return item() ?? lot() ?? location() ?? supplier();
  }
}
