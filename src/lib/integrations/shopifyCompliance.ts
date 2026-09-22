import { getFirestore, type Firestore } from "firebase-admin/firestore";
import type { Customer, Integration, SalesOrder } from "@/lib/types";
import type { WriteOp } from "@/lib/store/types";
import { activityOp } from "@/lib/inventory";
import { adminApp } from "@/lib/mcp/adminStore";
import { nowIso } from "@/lib/utils";
import { describeCustomer, findCustomerRecords, findShopifyOrders, redactCustomerPatch, redactOrderPatch, type ComplianceRequest } from "@/lib/server/shopifyComplianceRules";
import { disconnectIntegration } from "./connect";
import { requireServiceAccount, systemContext, type ServerContext } from "./server";

/**
 * Acts on Shopify's mandatory privacy webhooks across every workspace that is
 * connected to the shop named in the request. A data request is recorded in
 * the workspace's activity so the team can send the customer their data; a
 * customer redaction scrubs the person from their orders and customer record;
 * a shop redaction erases the store's credentials and connection details.
 */

export interface ComplianceOutcome {
  workspaces: number;
  orders: number;
  customers: number;
}

/** Every workspace whose Shopify connection points at this shop, connected or not. */
export async function findShopifyWorkspaces(db: Firestore, shop: string): Promise<Array<{ workspaceId: string; integration: Integration }>> {
  const refs = await db.collection("workspaces").listDocuments();
  const found: Array<{ workspaceId: string; integration: Integration }> = [];
  for (let i = 0; i < refs.length; i += 100) {
    const snaps = await db.getAll(...refs.slice(i, i + 100).map((r) => r.collection("integrations").doc("shopify")));
    for (const snap of snaps) {
      if (!snap.exists) continue;
      const integration = snap.data() as Integration;
      if (integration.config?.shop === shop) found.push({ workspaceId: snap.ref.parent.parent!.id, integration });
    }
  }
  return found;
}

function orderList(orders: SalesOrder[]): string {
  const numbers = orders.slice(0, 10).map((o) => o.number);
  return orders.length > 10 ? `${numbers.join(", ")} and ${orders.length - 10} more` : numbers.join(", ");
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

async function recordDataRequest(ctx: ServerContext, request: ComplianceRequest, orders: SalesOrder[], customers: Customer[]): Promise<void> {
  const who = describeCustomer(request);
  const found = orders.length || customers.length ? `${plural(orders.length, "order")}${orders.length ? ` (${orderList(orders)})` : ""} and ${plural(customers.length, "customer record")}` : "no matching orders or customer records";
  const message = `Shopify data request${request.requestId ? ` #${request.requestId}` : ""} for ${who}: ${found} in this workspace. Shopify asks that the customer receive a copy of their data within 30 days.`;
  await ctx.store.batch([activityOp(ctx.actor, "integration.compliance", message, { entityType: "integration", entityId: "shopify", meta: { topic: request.topic, requestId: request.requestId, orderIds: orders.map((o) => o.id), customerIds: customers.map((c) => c.id) } })]);
}

async function redactCustomer(ctx: ServerContext, request: ComplianceRequest, orders: SalesOrder[], customers: Customer[]): Promise<void> {
  const now = nowIso();
  const ops: WriteOp[] = [];
  for (const o of orders) ops.push({ op: "patch", collection: "orders", id: o.id, patch: redactOrderPatch() });
  for (const c of customers) ops.push({ op: "patch", collection: "customers", id: c.id, patch: redactCustomerPatch(now) });
  const who = describeCustomer(request);
  const done = orders.length || customers.length ? `removed their details from ${plural(orders.length, "order")}${orders.length ? ` (${orderList(orders)})` : ""} and ${plural(customers.length, "customer record")}` : "no matching orders or customer records were found";
  ops.push(activityOp(ctx.actor, "integration.compliance", `Shopify asked to erase the data of ${who}: ${done}.`, { entityType: "integration", entityId: "shopify", meta: { topic: request.topic, orderIds: orders.map((o) => o.id), customerIds: customers.map((c) => c.id) } }));
  await ctx.store.batch(ops);
}

/** The store uninstalled the app: drop its token, webhooks and address. The workspace's own records stay with the workspace. */
async function redactShop(ctx: ServerContext, integration: Integration): Promise<void> {
  if (integration.status !== "not_connected") await disconnectIntegration(ctx, "shopify");
  await ctx.store.batch([
    { op: "patch", collection: "integrations", id: "shopify", patch: { config: {}, webhooks: [], lastSyncAt: undefined, lastSyncSummary: undefined, lastError: undefined } },
    activityOp(ctx.actor, "integration.compliance", `Shopify asked to erase ${integration.config?.shop ?? "the store"}'s data after the app was uninstalled: its access token, address and webhook registrations were removed.`, { entityType: "integration", entityId: "shopify", meta: { topic: "shop/redact" } }),
  ]);
}

export async function handleShopifyCompliance(request: ComplianceRequest, sa = requireServiceAccount()): Promise<ComplianceOutcome> {
  const db = getFirestore(adminApp(sa));
  const matches = await findShopifyWorkspaces(db, request.shop);
  const outcome: ComplianceOutcome = { workspaces: matches.length, orders: 0, customers: 0 };
  for (const { workspaceId, integration } of matches) {
    const ctx = systemContext(workspaceId, sa);
    if (request.topic === "shop/redact") {
      await redactShop(ctx, integration);
      continue;
    }
    const [orders, customers] = await Promise.all([ctx.store.list("orders"), ctx.store.list("customers")]);
    const matchedOrders = findShopifyOrders(orders, request);
    const matchedCustomers = findCustomerRecords(customers, request, matchedOrders);
    outcome.orders += matchedOrders.length;
    outcome.customers += matchedCustomers.length;
    if (request.topic === "customers/data_request") await recordDataRequest(ctx, request, matchedOrders, matchedCustomers);
    else await redactCustomer(ctx, request, matchedOrders, matchedCustomers);
  }
  return outcome;
}
