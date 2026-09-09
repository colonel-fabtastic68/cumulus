"use client";

import type { Item, OrderSource, SalesOrder } from "@/lib/types";
import { formatMoney } from "@/lib/format";
import { openQty } from "@/lib/inventory";
import { round, sum } from "@/lib/utils";
import { Badge, type BadgeTone } from "@/components/ui";

export type OrderFilter = "open" | "partial" | "backordered" | "fulfilled" | "cancelled" | "all";

export const SOURCE_LABEL: Record<OrderSource, string> = {
  manual: "Manual",
  shopify: "Shopify",
  woocommerce: "WooCommerce",
  import: "Import",
};

const SOURCE_TONE: Record<OrderSource, BadgeTone> = {
  manual: "default",
  shopify: "accent",
  woocommerce: "info",
  import: "default",
};

export function SourceBadge({ source }: { source: OrderSource }) {
  return <Badge tone={SOURCE_TONE[source] ?? "default"}>{SOURCE_LABEL[source] ?? source}</Badge>;
}

/** Sum of qty × unit price across the order's lines. */
export function orderTotal(order: SalesOrder): number {
  return round(sum(order.lines.map((l) => l.qty * l.unitPrice)));
}

/** Total units across the order's lines. */
export function orderUnits(order: SalesOrder): number {
  return sum(order.lines.map((l) => l.qty));
}

/** Units still to ship. */
export function orderOpenUnits(order: SalesOrder): number {
  return sum(order.lines.map(openQty));
}

/** Units already shipped. */
export function orderShippedUnits(order: SalesOrder): number {
  return sum(order.lines.map((l) => l.shipped ?? 0));
}

export interface ShortLine {
  sku: string;
  have: number;
  need: number;
  isAssembly: boolean;
}

export interface OrderAvailability {
  ready: boolean;
  short: ShortLine[];
}

/** Whether every open line can ship from what is on the shelf right now. */
export function orderAvailability(order: SalesOrder, byId: Map<string, Item>): OrderAvailability {
  const short: ShortLine[] = [];
  for (const line of order.lines) {
    const need = openQty(line);
    if (need <= 0) continue;
    const item = byId.get(line.itemId);
    const have = item?.onHand ?? 0;
    if (have < need) {
      short.push({ sku: item?.sku ?? line.itemId, have, need, isAssembly: !!item && item.type === "assembly" && item.bom.length > 0 });
    }
  }
  return { ready: short.length === 0, short };
}

export function describeShortages(short: ShortLine[]): string {
  return short.map((s) => `${s.sku}: have ${s.have}, need ${s.need}`).join("; ");
}

/** The currency symbol on its own, for input prefixes. */
export function currencySymbol(currency: string): string {
  return formatMoney(0, currency).replace(/[\d.,\s]/g, "") || "$";
}

export function withinDays(iso: string | undefined, days: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= days * 86_400_000;
}
