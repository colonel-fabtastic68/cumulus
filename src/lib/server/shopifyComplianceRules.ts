import { createHmac, timingSafeEqual } from "node:crypto";
import type { Customer, SalesOrder } from "@/lib/types";

/**
 * Shopify's mandatory privacy webhooks, with no Firebase or network code so
 * the rules can be tested alone: signature verification, payload parsing,
 * which records a request touches, and what redaction leaves behind.
 * https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
 */

export const SHOPIFY_COMPLIANCE_TOPICS = ["customers/data_request", "customers/redact", "shop/redact"] as const;
export type ShopifyComplianceTopic = (typeof SHOPIFY_COMPLIANCE_TOPICS)[number];

export function isShopifyComplianceTopic(topic: string): topic is ShopifyComplianceTopic {
  return (SHOPIFY_COMPLIANCE_TOPICS as readonly string[]).includes(topic);
}

/** Shopify signs the raw body with the app's client secret: HMAC-SHA256, base64, in X-Shopify-Hmac-Sha256. */
export function verifyShopifyWebhookHmac(rawBody: string, header: string | null, clientSecret: string): boolean {
  if (!header || !clientSecret) return false;
  const expected = createHmac("sha256", clientSecret).update(rawBody, "utf8").digest();
  const given = Buffer.from(header.trim(), "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface ComplianceRequest {
  topic: ShopifyComplianceTopic;
  /** your-store.myshopify.com, lower-case. */
  shop: string;
  shopId?: string;
  customer?: { id?: string; email?: string; phone?: string };
  /** Shopify order ids named in the request. */
  orderIds: string[];
  /** Shopify's id for a customers/data_request. */
  requestId?: string;
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function asIdList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(asString).filter((s): s is string => Boolean(s)) : [];
}

/** Reads the fields the three topics carry; throws on a body that is not a compliance payload. */
export function parseComplianceRequest(topic: ShopifyComplianceTopic, payload: unknown): ComplianceRequest {
  if (!payload || typeof payload !== "object") throw new Error("The payload is not an object.");
  const p = payload as Record<string, unknown>;
  const shop = (asString(p.shop_domain) ?? "").toLowerCase();
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(shop)) throw new Error("shop_domain is missing or not a .myshopify.com address.");
  const request: ComplianceRequest = { topic, shop, shopId: asString(p.shop_id), orderIds: [] };
  if (topic === "shop/redact") return request;
  const c = p.customer && typeof p.customer === "object" ? (p.customer as Record<string, unknown>) : {};
  request.customer = { id: asString(c.id), email: asString(c.email)?.toLowerCase(), phone: asString(c.phone) };
  request.orderIds = asIdList(topic === "customers/redact" ? p.orders_to_redact : p.orders_requested);
  if (topic === "customers/data_request") {
    const dr = p.data_request && typeof p.data_request === "object" ? (p.data_request as Record<string, unknown>) : {};
    request.requestId = asString(dr.id);
  }
  return request;
}

/** Digits only; the last ten digits decide, so +1 (555) 625-1199 and 5556251199 match. */
export function phonesMatch(a?: string | null, b?: string | null): boolean {
  const da = (a ?? "").replace(/\D/g, "");
  const db = (b ?? "").replace(/\D/g, "");
  if (da.length < 7 || db.length < 7) return false;
  return da.slice(-10) === db.slice(-10);
}

export function emailsMatch(a?: string | null, b?: string | null): boolean {
  const ea = (a ?? "").trim().toLowerCase();
  const eb = (b ?? "").trim().toLowerCase();
  return Boolean(ea) && ea === eb;
}

function matchesCustomer(record: { email?: string | null; phone?: string | null }, customer: ComplianceRequest["customer"]): boolean {
  if (!customer) return false;
  return emailsMatch(record.email, customer.email) || phonesMatch(record.phone, customer.phone);
}

/** Orders that came from this shop and belong to the request: named by id, or placed with the customer's email. */
export function findShopifyOrders(orders: SalesOrder[], request: ComplianceRequest): SalesOrder[] {
  const ids = new Set(request.orderIds);
  return orders.filter((o) => o.channel === "shopify" && ((o.externalId && ids.has(o.externalId)) || emailsMatch(o.customerEmail, request.customer?.email)));
}

/** Customer records the shop put here: created by a Shopify sync with a matching email or phone, or the customer on one of the matched orders. */
export function findCustomerRecords(customers: Customer[], request: ComplianceRequest, matchedOrders: SalesOrder[]): Customer[] {
  const fromOrders = new Set(matchedOrders.map((o) => o.customerId).filter(Boolean));
  return customers.filter((c) => fromOrders.has(c.id) || (c.source === "shopify" && matchesCustomer({ email: c.email, phone: c.phone ?? c.address?.phone }, request.customer)));
}

export const REDACTED_NAME = "Redacted customer";

/** Removes everything on an order that identifies the buyer; lines, totals and status stay for the books. */
export function redactOrderPatch(): Partial<SalesOrder> {
  return { customer: REDACTED_NAME, customerEmail: undefined, shipTo: undefined, note: undefined };
}

/** Removes the person's details from a customer record; the id survives so orders still resolve. */
export function redactCustomerPatch(now: string): Partial<Customer> {
  return { name: REDACTED_NAME, email: undefined, phone: undefined, address: undefined, contacts: undefined, notes: undefined, attributes: undefined, updatedAt: now };
}

/** How the request names the person, for the activity feed. */
export function describeCustomer(request: ComplianceRequest): string {
  const c = request.customer;
  return c?.email || c?.phone || (c?.id ? `Shopify customer ${c.id}` : "a customer");
}
