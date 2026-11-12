"use client";

import { useMemo, useState } from "react";
import { FileDown } from "lucide-react";
import { DEFAULT_ACCOUNTS, accountsFor, buildIif } from "@/lib/accounting/iif";
import { lastMonthEnd } from "@/lib/periodLock";
import { downloadBlob } from "@/lib/export/formats";
import { useCollection, useItems, useSettings } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { formatMoney, pluralize } from "@/lib/format";
import { Banner, Button, Checkbox, FormGrid, TextField, useToast } from "@/components/ui";
import { useSaveSettings } from "@/components/workspace/settings";

/**
 * Exports → QuickBooks Desktop (feature "quickbooksDesktop"): invoices for
 * shipped orders and bills for received deliveries in a period, as an IIF file
 * QuickBooks Desktop imports. The account names are kept in settings.accounting.
 */
export function QuickBooksDesktopExport() {
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const orders = useCollection("orders");
  const receipts = useCollection("receipts");
  const customers = useCollection("customers");
  const suppliers = useCollection("suppliers");
  const items = useItems();
  const user = useCurrentUser();
  const toast = useToast();
  const [to, setTo] = useState(() => lastMonthEnd());
  const [from, setFrom] = useState(() => `${lastMonthEnd().slice(0, 8)}01`);
  const [invoices, setInvoices] = useState(true);
  const [bills, setBills] = useState(true);
  const [names, setNames] = useState(true);
  const [accounts, setAccounts] = useState(() => accountsFor(settings));
  const [savingAccounts, setSavingAccounts] = useState(false);

  const result = useMemo(() => buildIif({ orders, receipts, items, customers, suppliers, accounting: accounts }, { from, to, invoices, bills, names }), [orders, receipts, items, customers, suppliers, accounts, from, to, invoices, bills, names]);
  const accountsDirty = JSON.stringify(accounts) !== JSON.stringify(accountsFor(settings));
  const nothing = result.invoices + result.bills === 0;
  const setAccount = (k: keyof typeof accounts) => (e: { target: { value: string } }) => setAccounts((a) => ({ ...a, [k]: e.target.value }));

  const saveAccounts = async () => {
    setSavingAccounts(true);
    try {
      await saveSettings({ accounting: accounts });
      toast("Account names saved", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save the account names", "critical");
    } finally {
      setSavingAccounts(false);
    }
  };

  const download = () => {
    // Plain ASCII-range text with CRLF line ends is what the importer expects; the type keeps browsers from re-encoding it.
    downloadBlob(`cumulusos-quickbooks-${from}-to-${to}.iif`, new Blob([result.text], { type: "text/plain;charset=utf-8" }));
    toast(`Exported ${pluralize(result.invoices, "invoice")} and ${pluralize(result.bills, "bill")} for QuickBooks Desktop`, "success");
  };

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div>
        <h3 className="text-[13.5px] font-semibold text-text">QuickBooks Desktop</h3>
        <p className="mt-0.5 text-[12.5px] text-text-secondary">Invoices for shipped orders and bills for received deliveries, as an IIF file. In QuickBooks: File → Utilities → Import → IIF Files.</p>
      </div>
      <Banner tone="warning" title="Import into a copy of the company file first">
        This export has not been checked against every QuickBooks Desktop version. The account names below must match your chart of accounts exactly, and each item must already exist in QuickBooks under the same name as its code here.
      </Banner>
      <FormGrid cols={2}>
        <TextField label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <TextField label="To" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
      </FormGrid>
      <div className="flex flex-col gap-1.5">
        <Checkbox label="Invoices" help={`${pluralize(result.invoices, "fulfilled order")} · ${formatMoney(result.invoiceTotal, settings.currency)}`} checked={invoices} onChange={setInvoices} />
        <Checkbox label="Bills" help={`${pluralize(result.bills, "received delivery", "received deliveries")} · ${formatMoney(result.billTotal, settings.currency)}`} checked={bills} onChange={setBills} />
        <Checkbox label="Customer and vendor names" help="Creates the ones QuickBooks does not have yet." checked={names} onChange={setNames} />
      </div>
      <details className="rounded-[var(--radius)] border border-border">
        <summary className="cursor-pointer px-3 py-2 text-[12.5px] font-medium text-text">Account names</summary>
        <div className="flex flex-col gap-2 border-t border-border p-3">
          <FormGrid cols={2}>
            <TextField label="Accounts receivable" value={accounts.receivable} onChange={setAccount("receivable")} placeholder={DEFAULT_ACCOUNTS.receivable} />
            <TextField label="Income" value={accounts.income} onChange={setAccount("income")} placeholder={DEFAULT_ACCOUNTS.income} />
            <TextField label="Accounts payable" value={accounts.payable} onChange={setAccount("payable")} placeholder={DEFAULT_ACCOUNTS.payable} />
            <TextField label="Inventory asset" value={accounts.inventoryAsset} onChange={setAccount("inventoryAsset")} placeholder={DEFAULT_ACCOUNTS.inventoryAsset} />
          </FormGrid>
          {canWrite(user) && (
            <div>
              <Button size="sm" onClick={() => void saveAccounts()} loading={savingAccounts} disabled={!accountsDirty}>
                Save account names
              </Button>
            </div>
          )}
        </div>
      </details>
      {result.skipped.length > 0 && (
        <p className="text-[12px] text-text-tertiary">
          Left out: {result.skipped.slice(0, 3).join("; ")}
          {result.skipped.length > 3 ? ` and ${result.skipped.length - 3} more` : ""}.
        </p>
      )}
      <div>
        <Button variant="primary" icon={<FileDown />} onClick={download} disabled={nothing || from > to}>
          Download .iif
        </Button>
        {nothing && <span className="ml-3 text-[12.5px] text-text-tertiary">Nothing shipped or received in this period.</span>}
      </div>
    </div>
  );
}
