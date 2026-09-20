import type { ActivityEvent, Build, Customer, Item, Location, Member, Receipt, Rma, SalesOrder, Shipment, Supplier, Transfer } from "./types";
import { crossRefText } from "./scan";
import { formatDate, formatQty, formatRelative } from "./format";

export type SearchKind = "Page" | "Item" | "BOM" | "Order" | "Shipment" | "Return" | "Receipt" | "Transfer" | "Build" | "Supplier" | "Customer" | "Location" | "Member" | "Integration" | "Report" | "Setting" | "Activity";

/** Group order in the search dialog. */
export const SEARCH_KINDS: SearchKind[] = ["Page", "Item", "BOM", "Order", "Shipment", "Return", "Receipt", "Transfer", "Build", "Supplier", "Customer", "Location", "Member", "Integration", "Report", "Setting", "Activity"];

export const SEARCH_GROUP_LABELS: Record<SearchKind, string> = {
  Page: "Pages",
  Item: "Items",
  BOM: "BOMs",
  Order: "Orders",
  Shipment: "Shipments",
  Return: "Returns",
  Receipt: "Receiving",
  Transfer: "Transfers",
  Build: "Builds",
  Supplier: "Suppliers",
  Customer: "Customers",
  Location: "Locations",
  Member: "Team",
  Integration: "Integrations",
  Report: "Reports",
  Setting: "Settings",
  Activity: "Activity",
};

export interface SearchHit {
  key: string;
  kind: SearchKind;
  label: string;
  sub?: string;
  href: string;
  /** 3 = a primary field starts with the query, 2 = a word starts with it, 1 = it appears somewhere. */
  score: number;
}

/** A destination that is not a record: a sidebar page, a report tab or a settings section. */
export interface SearchPage {
  kind: "Page" | "Report" | "Setting";
  label: string;
  href: string;
  sub?: string;
  /** Extra words the page answers to ("rma" for Returns). */
  keywords?: string;
}

export interface SearchIntegration {
  id: string;
  name: string;
  sub: string;
}

export interface SearchSource {
  pages: SearchPage[];
  items: Item[];
  orders: SalesOrder[];
  shipments: Shipment[];
  rmas: Rma[];
  receipts: Receipt[];
  transfers: Transfer[];
  builds: Build[];
  suppliers: Supplier[];
  customers?: Customer[];
  locations: Location[];
  members: Member[];
  integrations: SearchIntegration[];
  activity: ActivityEvent[];
}

export interface SearchOptions {
  /** Hits kept per group (Activity keeps at most 3). */
  perKind?: number;
  limit?: number;
}

type Field = string | undefined | null;

const WORD_BREAK = /[\s\-_/.,:;()#·|]/;

/** How well the fields answer the query; a prefix match on a primary field ranks highest. */
/**
 * Scores a record against the query. Every word of the query must appear
 * somewhere in the record (so "fuzz black" finds the black fuzz pedal); the
 * score is the sum of per-word scores, with a bonus when the whole phrase
 * starts a primary field. Zero when any word is missing.
 */
function scoreFields(q: string, primary: Field[], secondary: Field[] = []): number {
  const words = q.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const scoreWord = (w: string): number => {
    let best = 0;
    const check = (f: Field, prefixScore: number) => {
      if (best >= 3) return;
      const v = (f ?? "").toLowerCase();
      if (!v) return;
      if (v.startsWith(w)) {
        best = Math.max(best, prefixScore);
        return;
      }
      const i = v.indexOf(w);
      if (i < 0) return;
      best = Math.max(best, i === 0 || WORD_BREAK.test(v[i - 1]!) ? 2 : 1);
    };
    for (const f of primary) check(f, 3);
    for (const f of secondary) check(f, 2);
    return best;
  };
  let total = 0;
  for (const w of words) {
    const sc = scoreWord(w);
    if (sc === 0) return 0;
    total += sc;
  }
  if (words.length > 1 && primary.some((f) => (f ?? "").toLowerCase().startsWith(q))) total += 2;
  return total;
}

/** "in_transit" → "In transit". */
export function humanize(s: string): string {
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Everything the top-bar search covers: every sidebar page except Exports and
 * Strato, plus the records behind them. Results come back grouped in
 * SEARCH_KINDS order, best matches first within each group.
 */
export function searchWorkspace(query: string, src: SearchSource, { perKind = 8, limit = 60 }: SearchOptions = {}): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const groups = new Map<SearchKind, SearchHit[]>();
  const add = (kind: SearchKind, score: number, hit: Omit<SearchHit, "kind" | "score">) => {
    if (score <= 0) return;
    let g = groups.get(kind);
    if (!g) groups.set(kind, (g = []));
    g.push({ ...hit, kind, score });
  };

  const itemsById = new Map(src.items.map((i) => [i.id, i]));
  const locationName = (id?: string) => src.locations.find((l) => l.id === id)?.name ?? "";
  const supplierName = (id?: string) => src.suppliers.find((s) => s.id === id)?.name;
  const orderNumber = (id?: string) => src.orders.find((o) => o.id === id)?.number;

  for (const p of src.pages) add(p.kind, scoreFields(q, [p.label], [p.keywords, p.sub]), { key: p.href, label: p.label, sub: p.sub, href: p.href });

  for (const i of src.items) {
    const suppliers = [i.supplierId, ...(i.suppliers ?? []).map((s) => s.supplierId)].map(supplierName).join(" ");
    const score = scoreFields(q, [i.sku, i.name, i.barcode], [i.category, i.brand, i.supplierSku, suppliers, i.location, i.description, i.tags.join(" "), crossRefText(i), i.attributes ? Object.values(i.attributes).join(" ") : undefined]);
    if (!score) continue;
    const viaXref = !!i.crossRefs?.some((r) => r.number.toLowerCase().includes(q));
    add(i.type === "assembly" ? "BOM" : "Item", score, {
      key: i.id,
      label: `${i.sku} · ${i.name}`,
      sub: `${formatQty(i.onHand, i.unit)} on hand${viaXref ? " · matched a cross-reference" : ""}`,
      href: `/inventory/${i.id}`,
    });
  }

  for (const o of src.orders) {
    add("Order", scoreFields(q, [o.number, o.customer, o.externalRef], [o.customerEmail, o.note, o.shipTo?.name, o.shipTo?.company, o.shipTo?.city]), {
      key: o.id,
      label: `${o.number} · ${o.customer}`,
      sub: humanize(o.status === "partial" ? "partly shipped" : o.status),
      href: `/orders?highlight=${o.id}`,
    });
  }

  for (const s of src.shipments) {
    add("Shipment", scoreFields(q, [s.number, s.trackingNumber], [s.carrier, s.service, s.note]), {
      key: s.id,
      label: `${s.number} · ${[s.carrier, s.trackingNumber].filter(Boolean).join(" ") || "Shipment"}`,
      sub: [orderNumber(s.orderId) && `Order ${orderNumber(s.orderId)}`, s.trackingStatus].filter(Boolean).join(" · ") || undefined,
      href: `/orders?highlight=${s.orderId}`,
    });
  }

  for (const r of src.rmas) {
    add("Return", scoreFields(q, [r.number, r.customer, r.reference], [r.reason, r.note]), {
      key: r.id,
      label: `${r.number} · ${r.customer}`,
      sub: [humanize(r.status), r.reason].filter(Boolean).join(" · "),
      href: `/rmas?highlight=${r.id}`,
    });
  }

  for (const r of src.receipts) {
    const supplier = supplierName(r.supplierId);
    add("Receipt", scoreFields(q, [r.number, r.reference, supplier], [r.note]), {
      key: r.id,
      label: `${r.number} · ${supplier ?? "No supplier"}`,
      sub: `${humanize(r.status)} · ${formatDate(r.receivedAt)}`,
      href: `/receiving?highlight=${r.id}`,
    });
  }

  for (const t of src.transfers) {
    const from = locationName(t.fromLocationId);
    const to = locationName(t.toLocationId);
    add("Transfer", scoreFields(q, [t.number, t.trackingNumber], [t.carrier, t.note, from, to]), {
      key: t.id,
      label: `${t.number} · ${from || "?"} → ${to || "?"}`,
      sub: [humanize(t.status), t.carrier].filter(Boolean).join(" · "),
      href: `/transfers?highlight=${t.id}`,
    });
  }

  for (const b of src.builds) {
    const asm = itemsById.get(b.assemblyId);
    add("Build", scoreFields(q, [b.number], [asm?.sku, asm?.name, b.note]), {
      key: b.id,
      label: `${b.number} · ${asm?.sku ?? "Assembly"} × ${b.qty}`,
      sub: humanize(b.status),
      href: `/builds?highlight=${b.id}`,
    });
  }

  for (const s of src.suppliers) {
    add("Supplier", scoreFields(q, [s.name], [s.email, s.phone, s.website, s.terms, s.notes]), {
      key: s.id,
      label: s.name,
      sub: [s.email, s.terms].filter(Boolean).join(" · ") || undefined,
      href: `/suppliers?highlight=${s.id}`,
    });
  }

  for (const c of src.customers ?? []) {
    add("Customer", scoreFields(q, [c.name, c.email, c.company], [c.phone, c.tags?.join(" "), c.address?.city, c.notes]), {
      key: c.id,
      label: c.name,
      sub: [c.company, c.email, c.phone].filter(Boolean).join(" · ") || undefined,
      href: `/customers?highlight=${c.id}`,
    });
  }

  for (const l of src.locations) {
    add("Location", scoreFields(q, [l.name, l.code], [humanize(l.kind), l.address?.city]), {
      key: l.id,
      label: l.name,
      sub: [humanize(l.kind), l.code, l.active ? undefined : "inactive"].filter(Boolean).join(" · "),
      href: "/settings#locations",
    });
  }

  for (const m of src.members) {
    add("Member", scoreFields(q, [m.name, m.email], [m.role]), {
      key: m.id,
      label: m.name,
      sub: `${m.email} · ${humanize(m.role)}${m.status === "invited" ? " · invited" : ""}`,
      href: "/team",
    });
  }

  for (const x of src.integrations) add("Integration", scoreFields(q, [x.name], [x.sub]), { key: x.id, label: x.name, sub: x.sub, href: "/integrations" });

  for (const a of src.activity) {
    add("Activity", scoreFields(q, [], [a.message, a.actorName]), {
      key: a.id,
      label: a.message,
      sub: `${a.actorName} · ${formatRelative(a.createdAt)}`,
      href: "/activity",
    });
  }

  // Groups with the strongest match come first ("Locations" the settings section beats a page that only
  // mentions locations), ties in SEARCH_KINDS order; within a group, best matches first.
  const ordered = SEARCH_KINDS.filter((k) => groups.has(k))
    .map((kind, order) => {
      const hits = groups.get(kind)!;
      hits.sort((a, b) => b.score - a.score);
      return { kind, hits, order, best: hits[0].score };
    })
    .sort((a, b) => b.best - a.best || a.order - b.order);
  const out: SearchHit[] = [];
  for (const { kind, hits } of ordered) {
    const keep = kind === "Activity" ? Math.min(perKind, 3) : perKind;
    for (const hit of hits.slice(0, keep)) {
      if (out.length >= limit) return out;
      out.push(hit);
    }
  }
  return out;
}
