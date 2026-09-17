import type { Customer, Quote, Rma, SalesOrder } from "@/lib/types";
import type { Store } from "@/lib/store/types";
import type { Actor } from "@/lib/inventory";
import { newId, nowIso } from "@/lib/utils";

/** Lightweight CRM: customers are matched by email first, then by exact name, so old orders that only carry a name still line up. */

export interface CustomerInput {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: Customer["address"];
  tags?: string[];
  notes?: string;
  source?: Customer["source"];
}

const norm = (s?: string) => (s ?? "").trim().toLowerCase();

export function findCustomer(customers: Customer[], ref: { id?: string; email?: string; name?: string }): Customer | undefined {
  if (ref.id) {
    const byId = customers.find((c) => c.id === ref.id);
    if (byId) return byId;
  }
  const email = norm(ref.email);
  if (email) {
    const byEmail = customers.find((c) => norm(c.email) === email);
    if (byEmail) return byEmail;
  }
  const name = norm(ref.name);
  if (name) return customers.find((c) => norm(c.name) === name);
  return undefined;
}

export async function saveCustomer(store: Store, actor: Actor, input: CustomerInput, existingId?: string): Promise<Customer> {
  const now = nowIso();
  const existing = existingId ? await store.get("customers", existingId) : null;
  const name = input.name.trim();
  if (!name) throw new Error("Give the customer a name.");
  const customer: Customer = {
    id: existing?.id ?? newId("cus"),
    name,
    email: input.email?.trim().toLowerCase() || undefined,
    phone: input.phone?.trim() || undefined,
    company: input.company?.trim() || undefined,
    address: input.address?.street1?.trim() ? input.address : undefined,
    tags: input.tags?.map((t) => t.trim()).filter(Boolean),
    notes: input.notes?.trim() || undefined,
    source: existing?.source ?? input.source ?? "manual",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    createdBy: existing?.createdBy ?? actor.id,
  };
  if (!customer.tags?.length) delete customer.tags;
  await store.put("customers", customer);
  return customer;
}

/** Returns the matching customer, or creates one from what an order or return knows. Used so every order points at a record. */
export async function ensureCustomer(store: Store, actor: Actor, ref: { name: string; email?: string; address?: Customer["address"]; source?: Customer["source"] }): Promise<Customer | undefined> {
  const name = ref.name.trim();
  if (!name) return undefined;
  const customers = await store.list("customers");
  const found = findCustomer(customers, { email: ref.email, name });
  if (found) {
    // Learn an email or address the record was missing.
    const patch: Partial<Customer> = {};
    if (!found.email && ref.email?.trim()) patch.email = ref.email.trim().toLowerCase();
    if (!found.address && ref.address?.street1?.trim()) patch.address = ref.address;
    if (Object.keys(patch).length) await store.patch("customers", found.id, { ...patch, updatedAt: nowIso() });
    return { ...found, ...patch };
  }
  return saveCustomer(store, actor, { name, email: ref.email, address: ref.address, source: ref.source ?? "order" });
}

export async function deleteCustomer(store: Store, id: string): Promise<void> {
  await store.remove("customers", id);
}

/** Everything on record for one customer, matched by id and, for older records, by name or email. */
export function customerHistory(c: Customer, src: { orders: SalesOrder[]; rmas: Rma[]; quotes: Quote[] }) {
  const matches = (ref: { customerId?: string; customer: string; customerEmail?: string }) => ref.customerId === c.id || (!!c.email && norm(ref.customerEmail) === norm(c.email)) || norm(ref.customer) === norm(c.name);
  const orders = src.orders.filter(matches).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const rmas = src.rmas.filter((r) => matches({ customerId: r.customerId, customer: r.customer })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const quotes = src.quotes.filter((q) => matches({ customer: q.customer })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const revenue = orders.filter((o) => o.status !== "cancelled").reduce((sum, o) => sum + o.lines.reduce((s, l) => s + l.qty * l.unitPrice, 0), 0);
  return { orders, rmas, quotes, revenue, lastOrderAt: orders[0]?.createdAt };
}

// ---- import -----------------------------------------------------------------------

export const CUSTOMER_FIELDS = ["name", "email", "phone", "company", "street1", "street2", "city", "state", "zip", "country", "tags", "notes"] as const;
export type CustomerField = (typeof CUSTOMER_FIELDS)[number];

const HEADER_HINTS: Record<CustomerField, RegExp> = {
  name: /^(customer|full|contact)?\s*name$|^customer$|^contact$/i,
  email: /e-?mail/i,
  phone: /phone|tel|mobile|cell/i,
  company: /company|organi[sz]ation|business|account/i,
  street1: /^(street|address)( ?1| line ?1)?$|^address$/i,
  street2: /(street|address) ?(2|line ?2)/i,
  city: /city|town/i,
  state: /state|province|region/i,
  zip: /zip|post(al)? ?code/i,
  country: /country/i,
  tags: /tags?|labels?|segment|group/i,
  notes: /notes?|comments?|remarks?/i,
};

/** Best-guess column mapping from spreadsheet headers. */
export function guessCustomerMapping(headers: string[]): Partial<Record<CustomerField, string>> {
  const out: Partial<Record<CustomerField, string>> = {};
  for (const field of CUSTOMER_FIELDS) {
    const h = headers.find((x) => HEADER_HINTS[field].test(x.trim()) && !Object.values(out).includes(x));
    if (h) out[field] = h;
  }
  // "First name"/"Last name" pairs become the name.
  if (!out.name) {
    const first = headers.find((h) => /first\s*name/i.test(h));
    const last = headers.find((h) => /last\s*name|surname/i.test(h));
    if (first) out.name = last ? `${first}+${last}` : first;
  }
  return out;
}

export function rowToCustomer(row: Record<string, string>, mapping: Partial<Record<CustomerField, string>>): CustomerInput | null {
  const get = (f: CustomerField) => {
    const col = mapping[f];
    if (!col) return "";
    if (col.includes("+")) return col.split("+").map((c) => row[c] ?? "").join(" ").trim();
    return (row[col] ?? "").trim();
  };
  const name = get("name") || get("company");
  if (!name) return null;
  const street1 = get("street1");
  return {
    name,
    email: get("email") || undefined,
    phone: get("phone") || undefined,
    company: get("company") || undefined,
    address: street1 ? { street1, street2: get("street2") || undefined, city: get("city"), state: get("state") || undefined, zip: get("zip"), country: (get("country") || "US").toUpperCase().slice(0, 2) } : undefined,
    tags: get("tags") ? get("tags").split(/[;,|]/).map((t) => t.trim()).filter(Boolean) : undefined,
    notes: get("notes") || undefined,
    source: "import",
  };
}

/** Upserts by email, then by name. Returns what happened. */
export async function importCustomers(store: Store, actor: Actor, inputs: CustomerInput[]): Promise<{ created: number; updated: number; skipped: number }> {
  const existing = await store.list("customers");
  const result = { created: 0, updated: 0, skipped: 0 };
  for (const input of inputs) {
    if (!input.name.trim()) {
      result.skipped++;
      continue;
    }
    const found = findCustomer(existing, { email: input.email, name: input.name });
    const saved = await saveCustomer(store, actor, { ...input, ...(found ? { source: found.source } : {}) }, found?.id);
    if (found) {
      result.updated++;
      Object.assign(found, saved);
    } else {
      result.created++;
      existing.push(saved);
    }
  }
  return result;
}
