"use client";

import { useMemo } from "react";
import type { Item, Member, Supplier, WorkspaceSettings } from "@/lib/types";
import { inventoryValue, isLowStock, reorderQty } from "@/lib/inventory";
import { formatMoney, formatQty } from "@/lib/format";

/** String-only form state so inputs stay controlled; converted on save. */
export interface SupplierDraft {
  name: string;
  email: string;
  phone: string;
  website: string;
  leadTimeDays: string;
  terms: string;
  notes: string;
}

export const TERMS_SUGGESTIONS = ["Net 15", "Net 30", "Net 60", "Prepaid", "Credit card", "COD"];

export function draftFromSupplier(s?: Supplier | null): SupplierDraft {
  return {
    name: s?.name ?? "",
    email: s?.email ?? "",
    phone: s?.phone ?? "",
    website: s?.website ?? "",
    leadTimeDays: s?.leadTimeDays !== undefined ? String(s.leadTimeDays) : "",
    terms: s?.terms ?? "",
    notes: s?.notes ?? "",
  };
}

export function isDraftDirty(a: SupplierDraft, b: SupplierDraft): boolean {
  return (Object.keys(a) as Array<keyof SupplierDraft>).some((k) => a[k].trim() !== b[k].trim());
}

/** Returns a readable problem, or null when the draft can be saved. */
export function validateDraft(d: SupplierDraft): string | null {
  if (!d.name.trim()) return "Enter the supplier's name";
  if (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return "Enter a valid email address";
  if (d.leadTimeDays.trim()) {
    const n = Number(d.leadTimeDays);
    if (!Number.isFinite(n) || n < 0) return "Lead time must be zero or more days";
  }
  return null;
}

/** Shape accepted by upsertSupplier. Blank fields become undefined so they are not stored as empty strings. */
export function draftToInput(d: SupplierDraft): Partial<Supplier> & { name: string } {
  const opt = (v: string) => (v.trim() ? v.trim() : undefined);
  const lead = d.leadTimeDays.trim() ? Math.round(Number(d.leadTimeDays)) : undefined;
  return {
    name: d.name.trim(),
    email: opt(d.email),
    phone: opt(d.phone),
    website: opt(d.website),
    leadTimeDays: lead !== undefined && Number.isFinite(lead) ? lead : undefined,
    terms: opt(d.terms),
    notes: opt(d.notes),
  };
}

/** Absolute URL for a website field that may have been typed without a scheme. */
export function websiteHref(website: string): string {
  const w = website.trim();
  return /^https?:\/\//i.test(w) ? w : `https://${w}`;
}

export function websiteLabel(website: string): string {
  return website
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");
}

export function formatLeadTime(days?: number): string {
  if (days === undefined || !Number.isFinite(days)) return "—";
  return `${days} ${days === 1 ? "day" : "days"}`;
}

export interface SupplierStats {
  /** Every item that names this supplier, low-stock items first then by SKU. */
  items: Item[];
  lowItems: Item[];
  /** On-hand value of the supplied items. */
  value: number;
}

export function supplierStats(items: Item[], supplierId: string): SupplierStats {
  const supplied = items
    .filter((i) => i.supplierId === supplierId)
    .sort((a, b) => Number(isLowStock(b)) - Number(isLowStock(a)) || a.sku.localeCompare(b.sku));
  return { items: supplied, lowItems: supplied.filter(isLowStock), value: inventoryValue(supplied) };
}

const EMPTY_STATS: SupplierStats = { items: [], lowItems: [], value: 0 };

/** Stats for every supplier in one pass, keyed by supplier id. */
export function useSupplierStats(items: Item[]): Map<string, SupplierStats> {
  return useMemo(() => {
    const ids = new Set(items.map((i) => i.supplierId).filter((id): id is string => !!id));
    return new Map(Array.from(ids).map((id) => [id, supplierStats(items, id)]));
  }, [items]);
}

export function statsFor(map: Map<string, SupplierStats>, supplierId: string): SupplierStats {
  return map.get(supplierId) ?? EMPTY_STATS;
}

/** Prompt handed to Nimbus by "Draft reorder email". */
export function reorderEmailPrompt(supplier: Supplier, stats: SupplierStats, settings: WorkspaceSettings, actor: Pick<Member, "name">): string {
  const describe = (i: Item) => {
    const parts = [`on hand ${formatQty(i.onHand, i.unit)}`, i.minQty !== undefined ? `min ${formatQty(i.minQty, i.unit)}` : null, `reorder ${formatQty(reorderQty(i), i.unit)}`, `last cost ${formatMoney(i.unitCost, settings.currency)}`, i.supplierSku ? `supplier part ${i.supplierSku}` : null];
    return `- ${i.sku} (${i.name}): ${parts.filter(Boolean).join(", ")}`;
  };
  const to = `${supplier.name}${supplier.email ? ` <${supplier.email}>` : ""}`;
  const meta = [supplier.leadTimeDays !== undefined ? `Their usual lead time is ${formatLeadTime(supplier.leadTimeDays)}.` : null, supplier.terms ? `Payment terms: ${supplier.terms}.` : null].filter(Boolean).join(" ");
  const lines: string[] = [];
  if (stats.lowItems.length > 0) {
    lines.push(`Draft a purchase email to ${to} reordering the items below, which are below their minimum stock level:`);
    lines.push(...stats.lowItems.map(describe));
    lines.push("");
    lines.push("Ask them to confirm unit pricing and a delivery date for the reorder quantities.");
  } else {
    lines.push(`Nothing we buy from ${to} is below minimum right now. Here is what they supply us:`);
    lines.push(...stats.items.slice(0, 15).map(describe));
    lines.push("");
    lines.push("Recommend which items are worth topping up soon, then draft a short email asking for current pricing and lead times on those.");
  }
  if (meta) lines.push(meta);
  lines.push(`Keep it concise and professional, and sign it from ${actor.name} at ${settings.companyName}.`);
  return lines.join("\n");
}
