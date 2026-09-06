import type { WorkspaceSnapshot } from "@/lib/types";
import { inventoryValue, isLowStock, reorderQty } from "@/lib/inventory";

/** Compact text snapshot of the workspace for Nimbus's system prompt. */
export function buildAgentContext(ws: Pick<WorkspaceSnapshot, "items" | "suppliers" | "orders" | "rmas" | "settings" | "members">, extra: { page?: string; selectedSkus?: string[] } = {}): string {
  const settings = ws.settings[0];
  const active = ws.items.filter((i) => i.status === "active");
  const low = ws.items.filter(isLowStock).sort((a, b) => a.onHand / (a.minQty || 1) - b.onHand / (b.minQty || 1));
  const cats = new Map<string, number>();
  for (const i of ws.items) cats.set(i.category ?? "Uncategorised", (cats.get(i.category ?? "Uncategorised") ?? 0) + 1);
  const openOrders = ws.orders.filter((o) => o.status === "open");
  const openRmas = ws.rmas.filter((r) => r.status === "open" || r.status === "inspecting");
  const lines: string[] = [];
  lines.push(`Company: ${settings?.companyName ?? "Unknown"} · Currency: ${settings?.currency ?? "USD"} · Relieve components: ${settings?.relievePolicy ?? "on_build"} · Track in-use: ${settings?.trackInUse ? "yes" : "no"} · Inactivity window: ${settings?.inactivityDays ?? 120} days`);
  lines.push(`Items: ${ws.items.length} total (${active.length} active, ${ws.items.filter((i) => i.type === "assembly").length} assemblies) · Inventory value: ${inventoryValue(ws.items).toFixed(2)} · Below min: ${low.length}`);
  lines.push(`Categories: ${Array.from(cats.entries()).map(([c, n]) => `${c} (${n})`).join(", ")}`);
  lines.push(`Suppliers: ${ws.suppliers.map((s) => `${s.name}${s.leadTimeDays ? ` [${s.leadTimeDays}d]` : ""}`).join(", ") || "none"}`);
  lines.push(`Open orders: ${openOrders.length}${openOrders.length ? ` (${openOrders.slice(0, 5).map((o) => `${o.number} ${o.customer}`).join("; ")})` : ""} · Open RMAs: ${openRmas.length}${openRmas.length ? ` (${openRmas.map((r) => r.number).join(", ")})` : ""}`);
  lines.push(`Team: ${ws.members.map((m) => `${m.name} (${m.role})`).join(", ")}`);
  if (low.length) {
    lines.push(`Below minimum (top ${Math.min(12, low.length)}): ${low.slice(0, 12).map((i) => `${i.sku} ${i.onHand}/${i.minQty} reorder ${reorderQty(i)}`).join("; ")}`);
  }
  if (extra.page) lines.push(`User is viewing: ${extra.page}`);
  if (extra.selectedSkus?.length) lines.push(`User has selected these SKUs in the table: ${extra.selectedSkus.join(", ")}`);
  return lines.join("\n");
}
