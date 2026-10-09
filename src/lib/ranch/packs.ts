import type { Item, PackComponent, PackListing } from "@/lib/types";

/**
 * Ranch pack math, free of I/O so it can be checked against real catalogs.
 *
 * Willo Ranch stocks cuts by the pound (one Square "Lot #" variation per
 * animal) but sells fixed-price packs on the web ("Wagyu Ribeye, 1 lb avg,
 * $70"). A PackListing says what one pack takes: pounds of one cut, or of
 * several cuts for a box. Everything here converts between the two.
 */

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Total pounds (item units) one pack takes. */
export function packWeight(listing: Pick<PackListing, "components">): number {
  return round3(listing.components.reduce((a, c) => a + (c.qty > 0 ? c.qty : 0), 0));
}

/**
 * Packs the store may sell right now: the scarcest component decides, minus the
 * listing's reserve. Inactive listings and listings with no usable component sell nothing.
 */
export function packsAvailable(listing: Pick<PackListing, "components" | "reserve" | "active">, itemsById: Map<string, Pick<Item, "onHand">>): number {
  if (!listing.active) return 0;
  const parts = listing.components.filter((c) => c.qty > 0);
  if (parts.length === 0) return 0;
  let packs = Infinity;
  for (const c of parts) {
    const onHand = itemsById.get(c.itemId)?.onHand ?? 0;
    // A hair of tolerance so 2.9999 lb from rounding still counts as 3 one-pound packs.
    packs = Math.min(packs, Math.floor(Math.max(0, onHand) / c.qty + 1e-6));
  }
  return Math.max(0, packs - Math.max(0, Math.floor(listing.reserve ?? 0)));
}

/** Web price per pound of a listing, for comparing with the counter price of its cut. */
export function pricePerPound(listing: Pick<PackListing, "components" | "price">): number | null {
  const w = packWeight(listing);
  return w > 0 ? round2(listing.price / w) : null;
}

/** A store order line as the bridge sees it. */
export interface StoreLine {
  sku?: string | null;
  productId?: string;
  variationId?: string;
  name: string;
  qty: number;
  /** Price per unit (pack) on the order. */
  unitPrice: number;
}

/** Finds the listing a store line was for: by store product first, then SKU (case-insensitive). */
export function matchListing(line: StoreLine, listings: PackListing[]): PackListing | undefined {
  const variation = line.variationId && line.variationId !== "0" ? line.variationId : undefined;
  const byProduct = listings.find((l) => l.woo && (variation ? l.woo.variationId === variation : !l.woo.variationId && l.woo.productId === line.productId));
  if (byProduct) return byProduct;
  const sku = line.sku?.trim().toUpperCase();
  return sku ? listings.find((l) => l.sku.trim().toUpperCase() === sku) : undefined;
}

export interface ExpandedOrder {
  /** Pounds per cut, with a per-pound price that keeps the order's value. */
  lines: Array<{ itemId: string; qty: number; unitPrice: number }>;
  packs: Array<{ sku: string; listingId: string; name: string; packs: number }>;
  unmatched: string[];
}

/**
 * Turns the packs on a store order into pounds of each cut. A box's line value
 * is split across its cuts by their counter price times weight (by weight alone
 * when no counter price is set), so revenue lands on the right cuts.
 */
export function expandOrder(storeLines: StoreLine[], listings: PackListing[], itemsById: Map<string, Pick<Item, "price">>): ExpandedOrder {
  const perItem = new Map<string, { qty: number; value: number }>();
  const packs: ExpandedOrder["packs"] = [];
  const unmatched: string[] = [];
  for (const line of storeLines) {
    if (!(line.qty > 0)) continue;
    const listing = matchListing(line, listings);
    const parts = listing?.components.filter((c) => c.qty > 0) ?? [];
    if (!listing || parts.length === 0) {
      unmatched.push(line.sku || line.name);
      continue;
    }
    packs.push({ sku: listing.sku, listingId: listing.id, name: listing.name, packs: line.qty });
    const lineValue = line.qty * line.unitPrice;
    const weights = parts.map((c) => c.qty * Math.max(0, itemsById.get(c.itemId)?.price ?? 0));
    const total = weights.reduce((a, b) => a + b, 0);
    parts.forEach((c, i) => {
      const share = total > 0 ? weights[i]! / total : c.qty / packWeight({ components: parts });
      const entry = perItem.get(c.itemId) ?? { qty: 0, value: 0 };
      entry.qty += c.qty * line.qty;
      entry.value += lineValue * share;
      perItem.set(c.itemId, entry);
    });
  }
  const lines = Array.from(perItem.entries()).map(([itemId, e]) => ({ itemId, qty: round3(e.qty), unitPrice: e.qty > 0 ? Math.round((e.value / e.qty) * 10000) / 10000 : 0 }));
  return { lines, packs, unmatched };
}

/** The cuts a set of listings draw from (to know which packs to re-count when stock moves). */
export function listingsUsing(listings: PackListing[], itemIds: Iterable<string>): PackListing[] {
  const ids = new Set(itemIds);
  return listings.filter((l) => l.components.some((c) => ids.has(c.itemId)));
}

// ---- price sheets ----------------------------------------------------------------

/**
 * Pounds in a pack-size label as the ranch writes them: "2 8oz avg/pack" (two
 * 8 oz steaks, 1 lb), "1.5lb avg/pack", "8oz avg/pack", "13lb avg", "6lb avg/box",
 * "1lb av/pack". Null when no weight can be read.
 */
export function parsePackSize(label: string): number | null {
  const text = label.toLowerCase().replace(/,/g, ".");
  const m = /(?:(\d+(?:\.\d+)?)\s*(?:x|×|\*)?\s+)?(\d+(?:\.\d+)?)\s*(lbs?|pounds?|oz|ounces?)\b/.exec(text);
  if (!m) return null;
  const count = m[1] ? Number(m[1]) : 1;
  const size = Number(m[2]);
  const unit = m[3]!;
  const pounds = unit.startsWith("oz") || unit.startsWith("ounce") ? size / 16 : size;
  const total = round3(count * pounds);
  return total > 0 ? total : null;
}

export interface SheetRow {
  name: string;
  packLabel: string;
  /** Pounds per pack read from the label; null when it could not be read. */
  packWeight: number | null;
  price: number | null;
  category?: string;
  description?: string;
}

function splitRow(line: string, delimiter: string): string[] {
  if (delimiter === "\t") return line.split("\t").map((c) => c.trim());
  // Minimal CSV: quoted cells may hold commas.
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      out.push(cell.trim());
      cell = "";
    } else cell += ch;
  }
  out.push(cell.trim());
  return out;
}

/**
 * Reads a price sheet pasted from a spreadsheet (tab-separated) or CSV with a
 * header row naming at least the product, pack size and price columns.
 */
export function parsePriceSheet(text: string): { rows: SheetRow[]; error?: string } {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], error: "Paste the header row and at least one product." };
  const delimiter = lines[0]!.includes("\t") ? "\t" : ",";
  const header = splitRow(lines[0]!, delimiter).map((h) => h.toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const nameCol = col("product name", "product", "name");
  const sizeCol = col("pack size", "pack", "size");
  const priceCol = col("price");
  const categoryCol = col("category");
  const descCol = col("short description", "description");
  if (nameCol < 0 || sizeCol < 0 || priceCol < 0) return { rows: [], error: "The header row needs Product Name, Pack Size and Price columns." };
  const rows: SheetRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitRow(line, delimiter);
    const name = cells[nameCol]?.trim() ?? "";
    if (!name) continue;
    const packLabel = cells[sizeCol]?.trim() ?? "";
    const priceText = (cells[priceCol] ?? "").replace(/[$\s,]/g, "");
    const price = priceText && Number.isFinite(Number(priceText)) ? Number(priceText) : null;
    rows.push({
      name,
      packLabel,
      packWeight: parsePackSize(packLabel),
      price,
      category: categoryCol >= 0 ? cells[categoryCol]?.trim() || undefined : undefined,
      description: descCol >= 0 ? cells[descCol]?.trim() || undefined : undefined,
    });
  }
  return { rows };
}

// ---- name matching ------------------------------------------------------------------

const STOP = new Set(["wagyu", "beef", "the", "and", "of", "per", "pkg", "pkgs", "pack", "packs", "oz", "lb", "lbs", "avg", "whole"]);

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !STOP.has(t) && !/^\d+$/.test(t))
    .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t));
}

/**
 * The item a product name most likely sells ("Wagyu New York Strip" → "New York
 * Steaks", "Wagyu Bavette" → "Bavette (Inside Skirt)"), preferring cuts with
 * stock over retired items. Returns undefined when nothing shares a word; staff
 * confirm the choice either way.
 */
export function suggestItem<T extends Pick<Item, "id" | "name"> & { onHand?: number }>(name: string, items: T[]): T | undefined {
  const want = tokens(name);
  if (want.length === 0) return undefined;
  let best: { item: T; score: number } | undefined;
  for (const item of items) {
    const have = tokens(item.name);
    if (have.length === 0) continue;
    const shared = want.filter((t) => have.includes(t)).length;
    if (shared === 0) continue;
    // Favour covering the product's words, then items without extra words. Web packs are steaks unless the
    // product says otherwise, so a roast or ground item loses a tie it was not named in ("Top Sirloin" → Steaks).
    const unnamed = (word: string) => (have.includes(word) && !want.includes(word) ? 0.1 : 0);
    // A pack has to come out of stock, so a cut with pounds on hand beats a retired item of the same name.
    const stocked = typeof item.onHand === "number" && item.onHand > 0 ? 0.4 : 0;
    const score = shared / want.length + (shared / have.length) * 0.5 + (have.includes("steak") && want.includes("steak") ? 0.05 : 0) - unnamed("roast") - unnamed("ground") + stocked;
    if (!best || score > best.score) best = { item, score };
  }
  return best?.item;
}

/** A blank listing for one cut. */
export function newListingFor(input: { name: string; sku?: string; itemId?: string; weight?: number | null; price?: number | null; packLabel?: string; category?: string }, id: string, now: string): PackListing {
  const components: PackComponent[] = input.itemId ? [{ itemId: input.itemId, qty: input.weight && input.weight > 0 ? input.weight : 1 }] : [];
  return {
    id,
    name: input.name.trim(),
    sku: (input.sku ?? "").trim().toUpperCase(),
    components,
    packLabel: input.packLabel?.trim() || undefined,
    price: input.price && input.price > 0 ? round2(input.price) : 0,
    category: input.category?.trim() || undefined,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}
