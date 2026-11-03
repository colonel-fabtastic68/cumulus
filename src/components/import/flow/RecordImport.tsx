"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Download } from "lucide-react";
import { Badge, Banner, Button, Card, Select, SimpleTable, useToast } from "@/components/ui";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { CUSTOMER_FIELDS, findCustomer, guessCustomerMapping, importCustomers, rowToCustomer, type CustomerField } from "@/lib/customers";
import { SUPPLIER_FIELDS, guessSupplierMapping, importSuppliers, rowToSupplier, type SupplierField } from "@/lib/suppliers";
import { pluralize } from "@/lib/format";
import { useCollection, useStore } from "@/lib/store/provider";
import type { ParsedSource } from "../types";

export type RecordKind = "customers" | "suppliers";
export type RecordStage = "map" | "review" | "done";

const CUSTOMER_LABELS: Record<CustomerField, string> = { name: "Name", email: "Email", phone: "Phone", company: "Company", street1: "Street", street2: "Street 2", city: "City", state: "State", zip: "ZIP", country: "Country", tags: "Tags", notes: "Notes" };
const SUPPLIER_LABELS: Record<SupplierField, string> = { name: "Supplier name", email: "Email", phone: "Phone", website: "Website", contactName: "Contact person", leadTimeDays: "Lead time (days)", terms: "Payment terms", notes: "Notes" };

interface Row {
  line: number;
  name: string;
  detail: string;
  status: "new" | "update";
  input: unknown;
}

interface RecordImportProps {
  kind: RecordKind;
  source: ParsedSource;
  onStage: (stage: RecordStage) => void;
  onBack: () => void;
  onRestart: () => void;
}

/**
 * Customers and suppliers in three screens: match the columns, review every
 * row with its New / Update status, import. Existing records are matched
 * (customers by email then name, suppliers by name) and updated, never
 * duplicated.
 */
export function RecordImport({ kind, source, onStage, onBack, onRestart }: RecordImportProps) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const customers = useCollection("customers");
  const suppliers = useCollection("suppliers");
  const writable = canWrite(user);
  const [stage, setStage] = useState<RecordStage>("map");
  const [mapping, setMapping] = useState<Record<string, string | undefined>>(() => (kind === "customers" ? guessCustomerMapping(source.headers) : guessSupplierMapping(source.headers)));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const notify = useRef(onStage);
  useEffect(() => {
    notify.current = onStage;
  }, [onStage]);
  useEffect(() => {
    notify.current(stage);
  }, [stage]);

  const fields: readonly string[] = kind === "customers" ? CUSTOMER_FIELDS : SUPPLIER_FIELDS;
  const labels: Record<string, string> = kind === "customers" ? CUSTOMER_LABELS : SUPPLIER_LABELS;
  const nameIsPair = kind === "customers" && (mapping.name ?? "").includes("+");
  const columnOptions = [{ value: "", label: "— not imported —" }, ...source.headers.map((h) => ({ value: h, label: h }))];

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const supplierByName = new Map(suppliers.map((s) => [s.name.trim().toLowerCase(), s]));
    source.rows.forEach((r, i) => {
      if (kind === "customers") {
        const c = rowToCustomer(r, mapping as Partial<Record<CustomerField, string>>);
        if (!c) return;
        const found = findCustomer(customers, { email: c.email, name: c.name });
        out.push({ line: i + 1, name: c.name, detail: [c.company, c.email, c.phone, c.address?.city].filter(Boolean).join(" · "), status: found ? "update" : "new", input: c });
      } else {
        const s = rowToSupplier(r, mapping as Partial<Record<SupplierField, string>>);
        if (!s) return;
        out.push({ line: i + 1, name: s.name, detail: [s.email, s.phone, s.website, s.leadTimeDays ? `${s.leadTimeDays}-day lead` : null].filter(Boolean).join(" · "), status: supplierByName.has(s.name.trim().toLowerCase()) ? "update" : "new", input: s });
      }
    });
    return out;
  }, [source.rows, mapping, kind, customers, suppliers]);
  const counts = { new: rows.filter((r) => r.status === "new").length, update: rows.filter((r) => r.status === "update").length, skipped: source.rows.length - rows.length };
  const samples = useMemo(() => Object.fromEntries(source.headers.map((h) => [h, source.rows.find((r) => r[h])?.[h] ?? ""])), [source]);

  const run = async () => {
    if (!writable || rows.length === 0) return;
    setBusy(true);
    try {
      const r = kind === "customers" ? await importCustomers(store, user, rows.map((x) => x.input as Parameters<typeof importCustomers>[2][number])) : await importSuppliers(store, user, rows.map((x) => x.input as Parameters<typeof importSuppliers>[2][number]));
      setResult(r);
      setStage("done");
      toast(`Imported ${pluralize(r.created + r.updated, kind === "customers" ? "customer" : "supplier")}`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(false);
    }
  };

  if (stage === "done" && result)
    return (
      <Card className="px-6 py-8 text-center">
        <h2 className="text-[16px] font-semibold text-text">Import complete</h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          {result.created} added, {result.updated} updated{result.skipped ? `, ${result.skipped} skipped without a name` : ""} from {source.name}.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button variant="primary" href={kind === "customers" ? "/customers" : "/suppliers"}>
            Open {kind}
          </Button>
          <Button onClick={onRestart}>Import something else</Button>
        </div>
      </Card>
    );

  if (stage === "review")
    return (
      <div className="flex flex-col gap-4">
        {!writable && (
          <Banner tone="warning" title="View-only access">
            Your role can review the file but not import it.
          </Banner>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Tile label="Rows" value={source.rows.length} />
          <Tile label="New" value={counts.new} tone="success" />
          <Tile label="Updates" value={counts.update} tone="info" />
        </div>
        {counts.skipped > 0 && (
          <Banner tone="warning">
            {pluralize(counts.skipped, "row")} without a name will be skipped. Go back and map the name column if that is wrong.
          </Banner>
        )}
        <Card padded={false}>
          <div className="max-h-[480px] overflow-auto">
            <SimpleTable>
              <thead>
                <tr>
                  <th className="w-12">#</th>
                  <th>Name</th>
                  <th>Details</th>
                  <th className="w-24">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((r) => (
                  <tr key={r.line}>
                    <td className="tabular text-text-tertiary">{r.line}</td>
                    <td className="text-text">{r.name}</td>
                    <td className="max-w-[420px] truncate text-text-secondary">{r.detail || "—"}</td>
                    <td>
                      <Badge tone={r.status === "new" ? "success" : "info"}>{r.status === "new" ? "New" : "Update"}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </SimpleTable>
          </div>
          {rows.length > 500 && <p className="px-4 py-2 text-[12px] text-text-tertiary">Showing 500 of {rows.length}; all of them import.</p>}
        </Card>
        <div className="flex items-center justify-between gap-2">
          <Button icon={<ArrowLeft />} onClick={() => setStage("map")} disabled={busy}>
            Back
          </Button>
          <Button variant="primary" icon={<Download />} onClick={() => void run()} loading={busy} disabled={!writable || rows.length === 0}>
            Import {pluralize(rows.length, kind === "customers" ? "customer" : "supplier")}
          </Button>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <Card padded={false}>
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-[13.5px] font-semibold text-text">Match columns to {kind === "customers" ? "customer" : "supplier"} fields</h3>
          <p className="mt-0.5 text-[12.5px] text-text-secondary">
            {source.headers.length} columns in {source.name}. {kind === "customers" ? "A first-name and last-name pair becomes the name." : "The supplier name is required."}
          </p>
        </div>
        <ul>
          {fields.map((f) => (
            <li key={f} className="grid grid-cols-1 gap-2 border-t border-border px-4 py-2.5 first:border-t-0 md:grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-3">
              <div className="text-[13px] font-medium text-text">
                {labels[f]}
                {f === "name" && <span className="ml-1 text-text-tertiary">required</span>}
              </div>
              <Select aria-label={`Column for ${labels[f]}`} value={f === "name" && nameIsPair ? "" : (mapping[f] ?? "")} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value || undefined }))} options={f === "name" && nameIsPair ? [{ value: "", label: mapping.name!.replace("+", " + ") }, ...columnOptions.slice(1)] : columnOptions} />
              <div className="truncate text-[12.5px] text-text-secondary">{mapping[f] && !mapping[f]!.includes("+") ? samples[mapping[f]!] || <span className="text-text-tertiary">—</span> : nameIsPair && f === "name" ? `${samples[mapping.name!.split("+")[0]!] ?? ""} ${samples[mapping.name!.split("+")[1]!] ?? ""}`.trim() : <span className="text-text-tertiary">—</span>}</div>
            </li>
          ))}
        </ul>
      </Card>
      {!mapping.name && !mapping.company && (
        <Banner tone="critical" title="Map a column to the name">
          Rows without a name cannot be imported.
        </Banner>
      )}
      <div className="flex items-center justify-between gap-2">
        <Button icon={<ArrowLeft />} onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" iconRight={<ArrowRight />} onClick={() => setStage("review")} disabled={rows.length === 0}>
          Review {pluralize(rows.length, "row")}
        </Button>
      </div>
    </div>
  );
}

function Tile({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "success" | "info" }) {
  const cls = { default: "text-text", success: "text-success", info: "text-info" }[tone];
  return (
    <div className="card px-4 py-3">
      <div className="text-[12.5px] font-medium text-text-secondary">{label}</div>
      <div className={`mt-1 text-[20px] font-semibold leading-7 tabular ${cls}`}>{value}</div>
    </div>
  );
}
