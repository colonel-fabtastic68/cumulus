import type { AccountingSettings, Customer, Item, Receipt, SalesOrder, Supplier } from "@/lib/types";
import { round, sum } from "@/lib/utils";

/**
 * QuickBooks Desktop export (feature "quickbooksDesktop").
 *
 * QuickBooks Desktop has no web API. The two ways in are the Web Connector (a
 * Windows service that polls a SOAP endpoint we would host) and IIF: a
 * tab-separated text file imported from File → Utilities → Import → IIF Files.
 * This is the IIF route: it needs nothing installed and is the first step
 * before a Web Connector sync.
 *
 * What is written:
 * - an invoice for every fulfilled sales order in the period (accounts
 *   receivable against income, one split per line with the item, quantity and price);
 * - a bill for every received delivery from a known supplier (accounts payable
 *   against the inventory asset account, one split per line);
 * - optionally the customers and vendors those transactions name.
 *
 * The transaction layout (TRNS / SPL / ENDTRNS, amounts that sum to zero,
 * negative quantities on invoice splits) follows Intuit's IIF import kit. The
 * account names must match the company file exactly, and items must already
 * exist in QuickBooks under the same names as the item codes here.
 * NOT YET VERIFIED against a real company file: do a test import into a copy first.
 */

export const DEFAULT_ACCOUNTS: Required<AccountingSettings> = {
  income: "Sales",
  cogs: "Cost of Goods Sold",
  inventoryAsset: "Inventory Asset",
  receivable: "Accounts Receivable",
  payable: "Accounts Payable",
};

export function accountsFor(settings: { accounting?: AccountingSettings } | null | undefined): Required<AccountingSettings> {
  const a = settings?.accounting ?? {};
  return {
    income: a.income?.trim() || DEFAULT_ACCOUNTS.income,
    cogs: a.cogs?.trim() || DEFAULT_ACCOUNTS.cogs,
    inventoryAsset: a.inventoryAsset?.trim() || DEFAULT_ACCOUNTS.inventoryAsset,
    receivable: a.receivable?.trim() || DEFAULT_ACCOUNTS.receivable,
    payable: a.payable?.trim() || DEFAULT_ACCOUNTS.payable,
  };
}

/** IIF is tab-separated with no quoting: tabs and line breaks inside a value would shift every column after it. */
function cell(v: string | number | undefined | null): string {
  if (v === undefined || v === null) return "";
  return typeof v === "number" ? String(v) : v.replace(/[\t\r\n]+/g, " ").trim();
}

function row(...cells: Array<string | number | undefined | null>): string {
  return cells.map(cell).join("\t");
}

/** QuickBooks reads dates as MM/DD/YYYY. */
export function iifDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

export interface IifSource {
  orders: SalesOrder[];
  receipts: Receipt[];
  items: Item[];
  customers: Customer[];
  suppliers: Supplier[];
  accounting?: AccountingSettings;
}

export interface IifOptions {
  /** Inclusive period, YYYY-MM-DD, compared with the day the order shipped or the delivery was received. */
  from: string;
  to: string;
  invoices: boolean;
  bills: boolean;
  /** Also write the customer and vendor names, so they are created if QuickBooks does not have them. */
  names: boolean;
}

export interface IifResult {
  text: string;
  invoices: number;
  bills: number;
  invoiceTotal: number;
  billTotal: number;
  /** Things left out and why, for the person running the export. */
  skipped: string[];
}

const TRNS_HEADER = ["!TRNS", "TRNSID", "TRNSTYPE", "DATE", "ACCNT", "NAME", "AMOUNT", "DOCNUM", "MEMO"];
const SPL_HEADER = ["!SPL", "SPLID", "TRNSTYPE", "DATE", "ACCNT", "NAME", "AMOUNT", "DOCNUM", "MEMO", "QNTY", "PRICE", "INVITEM"];

const day = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function buildIif(src: IifSource, opts: IifOptions): IifResult {
  const accounts = accountsFor(src);
  const byId = new Map(src.items.map((i) => [i.id, i]));
  const supplierById = new Map(src.suppliers.map((s) => [s.id, s]));
  const inPeriod = (iso: string | undefined) => !!iso && day(iso) >= opts.from && day(iso) <= opts.to;
  const lines: string[] = [];
  const skipped: string[] = [];

  const invoices = opts.invoices ? src.orders.filter((o) => o.status === "fulfilled" && inPeriod(o.fulfilledAt)).sort((a, b) => a.fulfilledAt!.localeCompare(b.fulfilledAt!)) : [];
  const received = opts.bills ? src.receipts.filter((r) => r.status === "received" && inPeriod(r.receivedAt)).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)) : [];
  const bills = received.filter((r) => {
    const supplier = r.supplierId ? supplierById.get(r.supplierId) : undefined;
    if (!supplier) skipped.push(`${r.number}: no supplier on the receipt, so there is nobody to bill from`);
    return !!supplier;
  });

  if (opts.names) {
    const customerNames = Array.from(new Set(invoices.map((o) => o.customer.trim()).filter(Boolean)));
    const vendorNames = Array.from(new Set(bills.map((r) => supplierById.get(r.supplierId!)!.name.trim())));
    if (customerNames.length) {
      lines.push(row("!CUST", "NAME"));
      for (const n of customerNames) lines.push(row("CUST", n));
    }
    if (vendorNames.length) {
      lines.push(row("!VEND", "NAME"));
      for (const n of vendorNames) lines.push(row("VEND", n));
    }
  }

  if (invoices.length || bills.length) lines.push(row(...TRNS_HEADER), row(...SPL_HEADER), row("!ENDTRNS"));

  let invoiceTotal = 0;
  for (const o of invoices) {
    const date = iifDate(o.fulfilledAt!);
    const total = round(sum(o.lines.map((l) => round(l.qty * l.unitPrice))));
    invoiceTotal += total;
    lines.push(row("TRNS", "", "INVOICE", date, accounts.receivable, o.customer, total, o.number, o.externalRef ?? ""));
    for (const l of o.lines) {
      const item = byId.get(l.itemId);
      // The receivable is a debit; each line credits income, so its amount and quantity are negative.
      lines.push(row("SPL", "", "INVOICE", date, accounts.income, "", -round(l.qty * l.unitPrice), o.number, item?.name ?? "", -l.qty, l.unitPrice, item?.sku ?? ""));
    }
    lines.push(row("ENDTRNS"));
  }

  let billTotal = 0;
  for (const r of bills) {
    const supplier = supplierById.get(r.supplierId!)!;
    const date = iifDate(r.receivedAt);
    const total = round(sum(r.lines.map((l) => round(l.qty * l.unitCost))));
    billTotal += total;
    // The payable is a credit (negative); each line debits the inventory asset.
    lines.push(row("TRNS", "", "BILL", date, accounts.payable, supplier.name, -total, r.reference || r.number, r.number));
    for (const l of r.lines) {
      const item = byId.get(l.itemId);
      lines.push(row("SPL", "", "BILL", date, accounts.inventoryAsset, "", round(l.qty * l.unitCost), r.reference || r.number, item?.name ?? "", l.qty, l.unitCost, item?.sku ?? ""));
    }
    lines.push(row("ENDTRNS"));
  }

  return { text: lines.join("\r\n") + (lines.length ? "\r\n" : ""), invoices: invoices.length, bills: bills.length, invoiceTotal: round(invoiceTotal), billTotal: round(billTotal), skipped };
}
