import type { Contact, Customer, IntakeIntent, IntakeLine, Item, SalesOrder, Supplier } from "@/lib/types";

/**
 * Reading a message that came in by email, phone or text: which items and
 * quantities it asks for, which order it is about and who sent it.
 *
 * This is plain matching against the catalog, so it runs in the browser with
 * no model call and gives the same answer every time. What it cannot place is
 * listed as unmatched, for a person or Strato to finish.
 *
 * No store and no ledger imports here: the sample company (src/lib/seed.ts)
 * reads its example messages with the same function.
 */

export interface ReadContext {
  items: Item[];
  orders: SalesOrder[];
  customers: Customer[];
  suppliers: Supplier[];
}

export interface MessageInput {
  from?: string;
  fromAddress?: string;
  subject?: string;
  body: string;
}

export interface MessageReading {
  intent: IntakeIntent;
  lines: IntakeLine[];
  /** Parts that read like an order line but matched no item. */
  unmatched: string[];
  orderId?: string;
  customerId?: string;
  /** The sender's name on record, when the address or name matched a customer or supplier. */
  knownAs?: string;
}

const MAX_LINES = 100;
const MAX_UNMATCHED = 8;

const norm = (s?: string) => (s ?? "").trim().toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The last ten digits, so "+1 (312) 555-0142" and "312.555.0142" compare equal. */
const phoneKey = (s?: string) => (s ?? "").replace(/\D/g, "").slice(-10);

/**
 * A quantity: a number standing on its own, or stuck to x, pc or ea ("12x", "x12").
 * Not part of a code (1590B, FG-OD1), a price ($159), a reference (#1042),
 * a date or time (11/20, 9:30), a percentage or a price break (20+).
 */
const QTY = /(?:(?<![\w$#/:.-])|(?<=(?:^|[^a-z0-9])[x×]))\d{1,5}(?:\.\d{1,3})?(?=$|(?:x|pcs?|ea)(?![a-z0-9])|[^\w%+/:.-]|\.(?!\d))/gi;

/**
 * A clause that asks for a quantity of something: "4 of the blue fuzz pedal",
 * "also 2 green knobs", "can we get 3 more". A few asking words may come first.
 */
const LINE_START = /^\W*(?:(?:also|and|plus|then|please|we|i|can|could|you|would|like|to|need|send|add|want|get|ship|order|us|me)\s+){0,5}(?:qty\.?\s*)?\d{1,5}\s*(?:x|×|pcs?|ea|of|units?)?\s+(?!(?:days?|weeks?|months?|years?|hours?|minutes?|mins?|am|pm)\b)[a-z]/i;

/** Clauses end at a line break, a comma or semicolon, "and", or the end of a sentence. */
const SPLIT = /\n+|;|,|\s+(?:and|plus|&)\s+|(?<=[.?!])\s+/i;
const PLACEHOLDER = /⟦(\d+)⟧/g;

const STOP_WORDS = new Set(["the", "and", "for", "with", "per", "our", "your", "you", "can", "get", "more", "some", "this", "that"]);

function nameWords(s: string): string[] {
  const out = new Set<string>();
  for (const raw of s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")) {
    if (raw.length < 3 || STOP_WORDS.has(raw)) continue;
    out.add(raw.length > 3 && raw.endsWith("s") ? raw.slice(0, -1) : raw);
  }
  return [...out];
}

function quantities(text: string): number[] {
  return [...text.matchAll(QTY)].map((m) => Number(m[0])).filter((n) => Number.isFinite(n) && n > 0);
}

/** Swaps every item code and full item name for a marker, so names with commas survive the split into clauses. */
function markItems(text: string, items: Item[]): string {
  const targets: Array<{ index: number; re: RegExp; length: number }> = [];
  items.forEach((item, index) => {
    if (item.status === "inactive") return;
    const sku = item.sku?.trim();
    if (sku && sku.length >= 2) targets.push({ index, length: sku.length, re: new RegExp(`(?<![\\w-])${escapeRe(sku)}(?![\\w-])`, "gi") });
    const name = item.name?.trim();
    if (name && name.length >= 4) targets.push({ index, length: name.length, re: new RegExp(`(?<![\\w-])${escapeRe(name)}(?![\\w-])`, "gi") });
  });
  // Longest first, so "1590B enclosure, powder coat black" wins over a shorter name inside it.
  targets.sort((a, b) => b.length - a.length);
  let out = text;
  for (const t of targets) out = out.replace(t.re, ` ⟦${t.index}⟧ `);
  return out;
}

interface Mention {
  index: number;
  start: number;
  end: number;
}

/** The one item whose name shares the most words with the clause, when it is clearly ahead of the rest. */
function looseMention(clause: string, items: Item[], words: string[][]): Mention | null {
  const lower = clause.toLowerCase();
  const present = new Set(nameWords(clause));
  let best: { index: number; hits: string[]; score: number } | null = null;
  let tied = false;
  for (let index = 0; index < words.length; index++) {
    const w = words[index]!;
    if (w.length === 0 || items[index]!.status === "inactive") continue;
    const hits = w.filter((x) => present.has(x));
    if (hits.length === 0 || (hits.length < 2 && w.length > 1)) continue;
    const score = hits.length / w.length;
    if (score < 0.5) continue;
    if (!best || score > best.score || (score === best.score && hits.length > best.hits.length)) {
      best = { index, hits, score };
      tied = false;
    } else if (score === best.score && hits.length === best.hits.length) {
      tied = true;
    }
  }
  if (!best || tied) return null;
  const starts = best.hits.map((h) => lower.indexOf(h)).filter((i) => i >= 0);
  if (starts.length === 0) return null;
  const end = best.hits.reduce((last, h) => Math.max(last, lower.indexOf(h) + h.length), 0);
  return { index: best.index, start: Math.min(...starts), end };
}

function findOrder(text: string, orders: SalesOrder[]): SalesOrder | undefined {
  if (orders.length === 0) return undefined;
  const byNumber = new Map(orders.map((o) => [o.number.toLowerCase(), o]));
  for (const m of text.matchAll(/\b[a-z]{1,6}-?\d{2,}\b/gi)) {
    const hit = byNumber.get(m[0].toLowerCase());
    if (hit) return hit;
  }
  // "order 1042" or "#1042": the digits of an order number, or the store's own reference.
  for (const m of text.matchAll(/(?:\border\s+(?:number\s+|no\.?\s+|#\s*)?|#)(\d{3,})\b/gi)) {
    const n = m[1]!;
    const hit = orders.find((o) => o.number.replace(/\D/g, "") === n || (o.externalRef ?? "").replace(/\D/g, "") === n);
    if (hit) return hit;
  }
  return undefined;
}

const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com", "proton.me", "protonmail.com", "live.com", "msn.com", "me.com"]);

function reaches(record: { email?: string; phone?: string; contacts?: Contact[] }, email: string, domain: string, phone: string): boolean {
  const emails = [record.email, ...(record.contacts ?? []).map((c) => c.email)].map(norm).filter(Boolean);
  const phones = [record.phone, ...(record.contacts ?? []).map((c) => c.phone)].map(phoneKey).filter((p) => p.length === 10);
  if (email && emails.includes(email)) return true;
  if (domain && !FREE_MAIL.has(domain) && emails.some((e) => e.endsWith(`@${domain}`))) return true;
  return phone.length === 10 && phones.includes(phone);
}

/** Who a message is from: a customer or supplier matched by address first, then by exact name. */
export function findSender(input: Pick<MessageInput, "from" | "fromAddress">, ctx: Pick<ReadContext, "customers" | "suppliers">): { customer?: Customer; supplier?: Supplier } {
  const address = norm(input.fromAddress);
  const email = address.includes("@") ? address : "";
  const domain = email ? email.slice(email.lastIndexOf("@") + 1) : "";
  const phone = email ? "" : phoneKey(input.fromAddress);
  const name = norm(input.from);
  const supplier = ctx.suppliers.find((s) => reaches(s, email, domain, phone)) ?? (name ? ctx.suppliers.find((s) => norm(s.name) === name) : undefined);
  if (supplier) return { supplier };
  const customer = ctx.customers.find((c) => !c.erasedAt && reaches(c, email, domain, phone)) ?? (name ? ctx.customers.find((c) => !c.erasedAt && (norm(c.name) === name || norm(c.company) === name)) : undefined);
  return { customer };
}

const CHANGE_WORDS = /\b(cancel|change|update|modify|swap|remove|instead|add\b[^.?!\n]{0,60}?\bto)\b/i;
const EXISTING_ORDER = /\b(my|our|that|the|this)\s+(last\s+|open\s+|current\s+)?order\b/i;
const STATUS_WORDS = /\b(where|status|track|tracking|shipped|ship date|eta|when will|arrive|arrived|delivery|delivered)\b/i;
const QUOTE_WORDS = /\b(quote|estimate|pricing)\b/i;
const STOCK_WORDS = /\b(price|how much|in stock|availability|available|lead time)\b/i;
const ORDER_WORDS = /\b(order|p\.?o\.?|purchase order|need|ship|send|reorder)\b/i;

export function readMessage(input: MessageInput, ctx: ReadContext): MessageReading {
  const raw = [input.subject, input.body].filter(Boolean).join("\n");
  const sender = findSender(input, ctx);
  const order = findOrder(raw, ctx.orders);

  const words = ctx.items.map((i) => nameWords(i.name ?? ""));
  const qtyByItem = new Map<string, number>();
  const unmatched: string[] = [];
  // An item named without a quantity, in case the next clause is the quantity on its own ("Need 20").
  let awaitingQty: string | null = null;
  for (const clause of markItems(raw, ctx.items).split(SPLIT)) {
    if (!clause.trim()) continue;
    let mentions: Mention[] = [...clause.matchAll(PLACEHOLDER)].map((m) => ({ index: Number(m[1]), start: m.index, end: m.index + m[0].length }));
    if (mentions.length === 0) {
      const loose = looseMention(clause, ctx.items, words);
      if (loose) mentions = [loose];
    }
    if (mentions.length === 0) {
      const alone = quantities(clause);
      if (awaitingQty && alone.length === 1 && clause.trim().split(/\s+/).length <= 4) qtyByItem.set(awaitingQty, alone[0]!);
      else if (LINE_START.test(clause) && unmatched.length < MAX_UNMATCHED) unmatched.push(clause.trim().slice(0, 140));
      awaitingQty = null;
      continue;
    }
    awaitingQty = null;
    // "12 x SKU" puts the quantity first; "SKU x 12" puts it after. One clause keeps to one way.
    const before = quantities(clause.slice(0, mentions[0]!.start)).length > 0;
    mentions.forEach((m, k) => {
      const gap = before ? clause.slice(k === 0 ? 0 : mentions[k - 1]!.end, m.start) : clause.slice(m.end, mentions[k + 1]?.start ?? clause.length);
      const found = quantities(gap);
      const qty = before ? found[found.length - 1] : found[0];
      const item = ctx.items[m.index];
      if (!item) return;
      if (qty === undefined && mentions.length === 1 && !qtyByItem.has(item.id)) awaitingQty = item.id;
      qtyByItem.set(item.id, (qtyByItem.get(item.id) ?? 0) + (qty ?? 1));
    });
  }
  const lines = [...qtyByItem].slice(0, MAX_LINES).map(([itemId, qty]) => ({ itemId, qty }));

  const asksForItems = lines.length > 0 || unmatched.length > 0;
  let intent: IntakeIntent;
  if (sender.supplier) intent = "supplier";
  else if (asksForItems && CHANGE_WORDS.test(raw) && (order || EXISTING_ORDER.test(raw))) intent = "change";
  else if (asksForItems && (QUOTE_WORDS.test(raw) || (STOCK_WORDS.test(raw) && !ORDER_WORDS.test(raw)))) intent = "quote";
  else if (asksForItems) intent = "order";
  else if (CHANGE_WORDS.test(raw) && order) intent = "change";
  else if (order || (STATUS_WORDS.test(raw) && EXISTING_ORDER.test(raw))) intent = "status";
  else if (QUOTE_WORDS.test(raw) || STOCK_WORDS.test(raw)) intent = "quote";
  else intent = "other";

  return {
    intent,
    // A supplier's message names parts without ordering them.
    lines: intent === "supplier" ? [] : lines,
    unmatched: intent === "supplier" ? [] : unmatched,
    orderId: order?.id,
    customerId: sender.customer?.id,
    knownAs: sender.supplier?.name ?? sender.customer?.name,
  };
}
