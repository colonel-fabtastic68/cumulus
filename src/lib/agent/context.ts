import type { WorkspaceSnapshot } from "@/lib/types";
import { costingMethod, inventoryValue, isLowStock, reorderQty } from "@/lib/inventory";
import { replenishmentPlan, replenishmentSummary } from "@/lib/replenishment";
import { COSTING_LABELS } from "@/lib/valuation";
import { describeAnswers } from "@/lib/onboarding";
import { jobIsOpen } from "@/lib/jobs";
import { workOrderIsLate, workOrderIsOpen, workOrderNeeds, workOrderRemaining } from "@/lib/workOrders";
import type { ToolFeatureFlags } from "./tools";

/** Compact text snapshot of the workspace for Strato's system prompt. */
export function buildAgentContext(ws: Pick<WorkspaceSnapshot, "items" | "suppliers" | "orders" | "rmas" | "settings" | "members"> & Partial<Pick<WorkspaceSnapshot, "integrations" | "purchaseOrders" | "purchaseOrderTemplates" | "movements" | "workOrders" | "jobs">>, extra: { page?: string; selectedSkus?: string[]; features?: ToolFeatureFlags } = {}): string {
  const settings = ws.settings[0];
  const active = ws.items.filter((i) => i.status === "active");
  const low = ws.items.filter((i) => isLowStock(i, ws.settings?.[0]?.stockAlerts)).sort((a, b) => a.onHand / (a.minQty || 1) - b.onHand / (b.minQty || 1));
  const cats = new Map<string, number>();
  for (const i of ws.items) cats.set(i.category ?? "Uncategorized", (cats.get(i.category ?? "Uncategorized") ?? 0) + 1);
  const openOrders = ws.orders.filter((o) => o.status === "open");
  const openRmas = ws.rmas.filter((r) => r.status === "open" || r.status === "inspecting");
  const lines: string[] = [];
  lines.push(`Company: ${settings?.companyName ?? "Unknown"} · Currency: ${settings?.currency ?? "USD"} · Costing: ${COSTING_LABELS[costingMethod(settings)]} · Relieve components: ${settings?.relievePolicy ?? "on_build"} · Track in-use: ${settings?.trackInUse ? "yes" : "no"} · Inactivity window: ${settings?.inactivityDays ?? 120} days`);
  const setup = describeAnswers(settings?.onboarding);
  if (setup) lines.push(`Setup answers: ${setup}${settings?.onboarding?.completedAt ? "" : " (guided setup not finished yet)"}`);
  lines.push(`Items: ${ws.items.length} total (${active.length} active, ${ws.items.filter((i) => i.type === "assembly").length} assemblies) · Inventory value: ${inventoryValue(ws.items).toFixed(2)} · Below min: ${low.length}`);
  lines.push(`Categories: ${Array.from(cats.entries()).map(([c, n]) => `${c} (${n})`).join(", ")}`);
  lines.push(`Suppliers: ${ws.suppliers.map((s) => `${s.name}${s.leadTimeDays ? ` [${s.leadTimeDays}d]` : ""}`).join(", ") || "none"}`);
  lines.push(`Open orders: ${openOrders.length}${openOrders.length ? ` (${openOrders.slice(0, 5).map((o) => `${o.number} ${o.customer}`).join("; ")})` : ""} · Open RMAs: ${openRmas.length}${openRmas.length ? ` (${openRmas.map((r) => r.number).join(", ")})` : ""}`);
  const openPos = (ws.purchaseOrders ?? []).filter((p) => p.status === "draft" || p.status === "sent" || p.status === "partial");
  lines.push(`Open purchase orders: ${openPos.length}${openPos.length ? ` (${openPos.slice(0, 5).map((p) => `${p.number} ${p.supplier} ${p.status}${p.expectedAt ? ` due ${p.expectedAt}` : ""}`).join("; ")})` : ""} · PO templates: ${(ws.purchaseOrderTemplates ?? []).map((t) => t.name).join(", ") || "none"}`);
  lines.push(`Team: ${ws.members.map((m) => `${m.name} (${m.role})`).join(", ")}`);
  const NAMES: Record<string, string> = { shopify: "Shopify", woocommerce: "WooCommerce", shippo: "Shippo", easypost: "EasyPost", quickbooks: "QuickBooks", square: "Square", clover: "Clover" };
  const connected = (ws.integrations ?? []).filter((c) => c.status === "connected" || c.status === "error");
  lines.push(
    connected.length
      ? `Connections: ${connected
          .map((c) => {
            const where = c.config?.shop ?? c.config?.siteUrl ?? c.config?.account;
            const linked = ws.items.filter((i) => !!i.channels?.[c.id as "shopify" | "woocommerce"]).length;
            const flags = c.id === "shopify" || c.id === "woocommerce" ? "store mirrors cumulusOS: items, prices, stock and status out; orders and new products in" : [c.settings?.syncProducts && "products in"].filter(Boolean).join(", ");
            return `${NAMES[c.id] ?? c.id} ${c.status === "error" ? "connected with an error" : "connected"}${where ? ` (${where})` : ""}${c.lastSyncAt ? `, last sync ${c.lastSyncAt.slice(0, 16).replace("T", " ")}` : ""}${flags ? ` [${flags}]` : ""}${linked ? `, ${linked} linked items` : ""}${c.missingSkus?.length ? `, ${c.missingSkus.length} store products without a SKU (not imported; fix with assignStoreSkus)` : ""}${c.lastError ? `, last error: ${c.lastError.slice(0, 120)}` : ""}`;
          })
          .join("; ")}`
      : "Connections: none connected (Shopify, WooCommerce, Shippo and EasyPost connect under Integrations)",
  );
  if (low.length) {
    lines.push(`Below minimum on the shelf (top ${Math.min(12, low.length)}): ${low.slice(0, 12).map((i) => `${i.sku} ${i.onHand}/${i.minQty} reorder ${reorderQty(i)}`).join("; ")}`);
  }
  if (ws.purchaseOrders && ws.movements) {
    const plan = replenishmentPlan({ items: ws.items, suppliers: ws.suppliers, purchaseOrders: ws.purchaseOrders, orders: ws.orders, movements: ws.movements, rule: settings?.stockAlerts });
    const s = replenishmentSummary(plan);
    const toOrder = plan.filter((r) => r.status === "order");
    lines.push(`Replenishment (forecast = on hand + on order − open sales orders): ${s.toOrder} to order${s.late ? ` (${s.late} late)` : ""}, est. ${s.estCost.toFixed(2)} across ${s.suppliers} supplier${s.suppliers === 1 ? "" : "s"}${s.builds ? `, ${s.builds} to build` : ""}; ${s.covered} covered by incoming; ${s.snoozed} snoozed; ${s.auto} on automatic rules${toOrder.length ? `. Top: ${toOrder.slice(0, 8).map((r) => `${r.item.sku} forecast ${r.forecast}/${r.min ?? "?"} ${r.route} ${r.toOrder}${r.supplier ? ` from ${r.supplier.name}` : ""}`).join("; ")}` : ""}`);
  }
  // Unreleased features: one line each, only while the feature is on and there is something open.
  if (extra.features?.workOrders) {
    const open = (ws.workOrders ?? []).filter(workOrderIsOpen).sort((a, b) => (a.dueOn ?? a.startOn ?? "9").localeCompare(b.dueOn ?? b.startOn ?? "9") || a.number.localeCompare(b.number));
    if (open.length) {
      const byId = new Map(ws.items.map((i) => [i.id, i]));
      const count = (status: string) => open.filter((w) => w.status === status).length;
      const late = open.filter((w) => workOrderIsLate(w)).length;
      const short = open.filter((w) => workOrderNeeds(w, ws.items).some((n) => n.shortage > 0));
      lines.push(
        `Work orders: ${open.length} open (${count("planned")} planned, ${count("released")} released, ${count("in_progress")} in progress)${late ? `, ${late} late` : ""}${short.length ? `; short on parts: ${short.slice(0, 6).map((w) => w.number).join(", ")}` : ""}. Next: ${open.slice(0, 5).map((w) => `${w.number} ${workOrderRemaining(w)} × ${byId.get(w.assemblyId)?.sku ?? "?"}${w.dueOn ? ` due ${w.dueOn}` : ""}`).join("; ")}`,
      );
    }
  }
  if (extra.features?.jobs) {
    const open = (ws.jobs ?? []).filter(jobIsOpen).sort((a, b) => (a.dueOn ?? "9").localeCompare(b.dueOn ?? "9") || a.number.localeCompare(b.number));
    if (open.length) lines.push(`Jobs: ${open.length} open (${open.slice(0, 5).map((j) => `${j.number} ${j.name}${j.customer ? ` for ${j.customer}` : ""}${j.status === "on_hold" ? ", on hold" : ""}${j.dueOn ? `, due ${j.dueOn}` : ""}`).join("; ")})`);
  }
  if (extra.page) lines.push(`User is viewing: ${extra.page}`);
  if (extra.selectedSkus?.length) lines.push(`User has selected these SKUs in the table: ${extra.selectedSkus.join(", ")}`);
  return lines.join("\n");
}
