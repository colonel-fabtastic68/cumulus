"use client";

import { useMemo, useState } from "react";
import { Upload, UsersRound } from "lucide-react";
import { Banner, Button, Select, useToast } from "@/components/ui";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { CUSTOMER_FIELDS, guessCustomerMapping, importCustomers, rowToCustomer, type CustomerField } from "@/lib/customers";
import { useStore } from "@/lib/store/provider";
import { pluralize } from "@/lib/format";
import { parseFile } from "@/components/import/parse";
import type { ParsedSource } from "@/components/import/types";

const LABELS: Record<CustomerField, string> = { name: "Name", email: "Email", phone: "Phone", company: "Company", street1: "Street", street2: "Street 2", city: "City", state: "State", zip: "ZIP", country: "Country", tags: "Tags", notes: "Notes" };

/** CSV in, customers out: guessed column mapping you can correct, a preview, then upsert by email or name. */
export function CustomerImport() {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const writable = canWrite(user);
  const [source, setSource] = useState<ParsedSource | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<CustomerField, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const onFile = async (file: File) => {
    setError(null);
    setDone(null);
    try {
      const parsed = await parseFile(file);
      setSource(parsed);
      setMapping(guessCustomerMapping(parsed.headers));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const preview = useMemo(() => (source ? source.rows.map((r) => rowToCustomer(r, mapping)).filter((c): c is NonNullable<typeof c> => !!c) : []), [source, mapping]);

  const run = async () => {
    if (!source) return;
    setBusy(true);
    setError(null);
    try {
      const r = await importCustomers(store, user, preview);
      setDone(`${r.created} added, ${r.updated} updated${r.skipped ? `, ${r.skipped} skipped (no name)` : ""}.`);
      toast(`Imported ${pluralize(r.created + r.updated, "customer")}`, "success");
      setSource(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const columnOptions = [{ value: "", label: "— not imported —" }, ...(source?.headers ?? []).map((h) => ({ value: h, label: h }))];
  const nameIsPair = (mapping.name ?? "").includes("+");

  return (
    <section className="card p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-hover text-text-secondary">
          <UsersRound className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold text-text">Import customers</h2>
          <p className="mt-0.5 text-[12.5px] text-text-secondary">A CSV with names, emails, phones and addresses. Existing customers are matched by email, then by name, and updated rather than duplicated.</p>
        </div>
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-[13px] font-medium text-text hover:bg-surface-hover">
          <Upload className="h-3.5 w-3.5" /> Choose CSV
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} disabled={!writable} />
        </label>
      </div>
      {done && <Banner tone="success" className="mt-4">{done}</Banner>}
      {error && <Banner tone="critical" className="mt-4">{error}</Banner>}
      {source && (
        <div className="mt-4 flex flex-col gap-4">
          <p className="text-[12.5px] text-text-secondary">
            <span className="font-medium text-text">{source.name}</span> · {pluralize(source.rows.length, "row")} · {preview.length} with a name
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {CUSTOMER_FIELDS.map((f) => (
              <Select key={f} label={LABELS[f]} value={f === "name" && nameIsPair ? "" : (mapping[f] ?? "")} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value || undefined }))} options={f === "name" && nameIsPair ? [{ value: "", label: `${mapping.name!.replace("+", " + ")}` }, ...columnOptions.slice(1)] : columnOptions} />
            ))}
          </div>
          {preview.length > 0 && (
            <div className="overflow-x-auto rounded-[var(--radius)] border border-border">
              <table className="w-full text-[12.5px]">
                <thead className="bg-surface-subdued text-left text-[11.5px] uppercase tracking-wide text-text-tertiary">
                  <tr>
                    <th className="px-3 py-1.5">Name</th>
                    <th className="px-3 py-1.5">Email</th>
                    <th className="px-3 py-1.5">Phone</th>
                    <th className="px-3 py-1.5">Company</th>
                    <th className="px-3 py-1.5">City</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {preview.slice(0, 5).map((c, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5 text-text">{c.name}</td>
                      <td className="px-3 py-1.5 text-text-secondary">{c.email ?? "—"}</td>
                      <td className="px-3 py-1.5 text-text-secondary">{c.phone ?? "—"}</td>
                      <td className="px-3 py-1.5 text-text-secondary">{c.company ?? "—"}</td>
                      <td className="px-3 py-1.5 text-text-secondary">{c.address?.city ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.length > 5 && <p className="px-3 py-1.5 text-[11.5px] text-text-tertiary">…and {preview.length - 5} more</p>}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button onClick={() => setSource(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => void run()} loading={busy} disabled={!writable || preview.length === 0}>
              Import {pluralize(preview.length, "customer")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
