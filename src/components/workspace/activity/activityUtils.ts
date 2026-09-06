import type { ActivityEvent, Item } from "@/lib/types";
import { formatDate, fromDateInput, toDateInput } from "@/lib/format";

export type ActivityFilter = "all" | "stock" | "items" | "orders" | "returns" | "builds" | "agent" | "team";
export type ActivityCategory = Exclude<ActivityFilter, "all">;

export const ACTIVITY_FILTERS: Array<{ value: ActivityFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "stock", label: "Stock" },
  { value: "items", label: "Items" },
  { value: "orders", label: "Orders" },
  { value: "returns", label: "Returns" },
  { value: "builds", label: "Builds" },
  { value: "agent", label: "Nimbus" },
  { value: "team", label: "Team" },
];

/** Map an ActivityType prefix to a feed category. Imports create items, so they file under Items. */
export function activityCategory(type: string): ActivityCategory | null {
  const prefix = type.split(".")[0];
  switch (prefix) {
    case "stock":
      return "stock";
    case "item":
    case "import":
      return "items";
    case "order":
      return "orders";
    case "rma":
      return "returns";
    case "build":
      return "builds";
    case "agent":
      return "agent";
    case "member":
    case "settings":
      return "team";
    default:
      return null;
  }
}

export interface ActivityLink {
  href: string;
  label: string;
}

/** Where an event's entity lives in the app, when it can still be resolved. */
export function activityLink(event: ActivityEvent, itemsById: Map<string, Item>): ActivityLink | null {
  if (!event.entityType || !event.entityId) return null;
  switch (event.entityType) {
    case "item":
      return itemsById.has(event.entityId) ? { href: "/inventory/" + event.entityId, label: "View item" } : null;
    case "receipt":
      return { href: "/receiving", label: "View receiving" };
    case "build":
      return { href: "/builds", label: "View builds" };
    case "order":
      return { href: "/orders?highlight=" + event.entityId, label: "View order" };
    case "rma":
      return { href: "/rmas?highlight=" + event.entityId, label: "View return" };
    case "supplier":
      return { href: "/suppliers?highlight=" + event.entityId, label: "View supplier" };
    case "member":
      return { href: "/team", label: "View team" };
    default:
      return null;
  }
}

/** Local calendar day (yyyy-mm-dd) for grouping. */
export function dayKey(iso: string): string {
  return toDateInput(iso);
}

/** "Today", "Yesterday", then a formatted date. */
export function dayLabel(key: string, now: Date = new Date()): string {
  const today = toDateInput(now.toISOString());
  const yesterday = toDateInput(new Date(now.getTime() - 86_400_000).toISOString());
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return formatDate(fromDateInput(key));
}

export interface ActivityDayGroup {
  key: string;
  label: string;
  events: ActivityEvent[];
}

/** Group newest-first events by local day, preserving order. */
export function groupByDay(events: ActivityEvent[]): ActivityDayGroup[] {
  const groups: ActivityDayGroup[] = [];
  const now = new Date();
  for (const e of events) {
    const key = dayKey(e.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.events.push(e);
    else groups.push({ key, label: dayLabel(key, now), events: [e] });
  }
  return groups;
}

const TYPE_LABELS: Record<string, string> = {
  "item.created": "Item created",
  "item.updated": "Item updated",
  "item.deleted": "Item deleted",
  "stock.adjusted": "Stock adjusted",
  "stock.received": "Stock received",
  "stock.written_off": "Write-off",
  "build.completed": "Build completed",
  "order.created": "Order created",
  "order.fulfilled": "Order fulfilled",
  "order.cancelled": "Order cancelled",
  "rma.created": "Return opened",
  "rma.resolved": "Return resolved",
  "import.completed": "Import",
  "agent.action": "Nimbus",
  "member.joined": "Team",
  "settings.updated": "Settings",
};

/** Human label for an event type; unknown types fall back to a tidied version of the raw string. */
export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
