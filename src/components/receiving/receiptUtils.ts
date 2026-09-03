import type { Item, Member, Receipt, Supplier } from "@/lib/types";
import { round, sum } from "@/lib/utils";

const DAY_MS = 86_400_000;

/** Lookup maps shared by the receiving table and detail modal. */
export interface ReceiptLookups {
  itemsById: Map<string, Item>;
  suppliersById: Map<string, Supplier>;
  membersById: Map<string, Member>;
}

/** Sum of qty x unit cost over all lines. */
export function receiptTotal(receipt: Receipt): number {
  return round(sum(receipt.lines.map((l) => l.qty * l.unitCost)));
}

/** True when the receipt was entered more than a day after its effective date. */
export function isBackDated(receipt: Receipt): boolean {
  const created = new Date(receipt.createdAt).getTime();
  const received = new Date(receipt.receivedAt).getTime();
  if (Number.isNaN(created) || Number.isNaN(received)) return false;
  return created - received > DAY_MS;
}

/** Narrow currency symbol for input prefixes, e.g. "$" or "€". */
export function currencySymbol(currency: string): string {
  try {
    const part = new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value ?? "$";
  } catch {
    return "$";
  }
}
