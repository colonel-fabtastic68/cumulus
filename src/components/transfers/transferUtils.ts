import type { Item, Transfer } from "@/lib/types";
import { sum } from "@/lib/utils";

export type TransferFilter = "in_transit" | "received" | "cancelled" | "all";

export const TRANSFER_STATUS_LABEL: Record<Transfer["status"], string> = {
  in_transit: "In transit",
  received: "Received",
  cancelled: "Cancelled",
};

export function transferUnits(t: Transfer): number {
  return sum(t.lines.map((l) => l.qty));
}

/** Parse "SKU, qty" lines (comma, tab or whitespace separated) against the item list. */
export function parseTransferList(text: string, items: Item[]): { lines: Array<{ item: Item; qty: number }>; errors: string[] } {
  const bySku = new Map(items.map((i) => [i.sku.toUpperCase(), i]));
  const byBarcode = new Map(items.filter((i) => i.barcode).map((i) => [i.barcode!.trim(), i]));
  const lines: Array<{ item: Item; qty: number }> = [];
  const errors: string[] = [];
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const row = raw.trim();
    if (!row) continue;
    const parts = row.split(/[,\t;]+|\s{2,}|\s+(?=\d+(?:\.\d+)?\s*$)/).map((p) => p.trim()).filter(Boolean);
    const code = parts[0] ?? "";
    const qty = parts.length > 1 ? Number(parts[parts.length - 1]) : 1;
    const item = bySku.get(code.toUpperCase()) ?? byBarcode.get(code);
    if (!item) {
      errors.push(`Line ${i + 1}: no item with SKU or barcode "${code}"`);
      continue;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push(`Line ${i + 1}: quantity for ${item.sku} must be a positive number`);
      continue;
    }
    const existing = lines.find((l) => l.item.id === item.id);
    if (existing) existing.qty += qty;
    else lines.push({ item, qty });
  }
  return { lines, errors };
}
