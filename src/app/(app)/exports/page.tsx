"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Download, Upload } from "lucide-react";
import { useCollection, useItems, useSettings } from "@/lib/store/provider";
import { useAgent } from "@/components/agent/AgentProvider";
import { DATASETS, datasetById, type DatasetId, type ExportSource, type ItemScope } from "@/lib/export/datasets";
import { FORMATS, buildTables, exportTables, type ExportFormat } from "@/lib/export/formats";
import { formatNumber, pluralize } from "@/lib/format";
import { Banner, Button, Checkbox, Page, QueryParamEffect, Segmented, Select, TextArea, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";

type ScopeMode = "all" | "filter" | "skus";

export default function ExportsPage() {
  const items = useItems();
  const settings = useSettings();
  const toast = useToast();
  const { setPageContext } = useAgent();
  const data = {
    items,
    movements: useCollection("movements"),
    lots: useCollection("lots"),
    suppliers: useCollection("suppliers"),
    receipts: useCollection("receipts"),
    builds: useCollection("builds"),
    orders: useCollection("orders"),
    rmas: useCollection("rmas"),
    members: useCollection("members"),
    activity: useCollection("activity"),
    integrations: useCollection("integrations"),
    settings: [settings],
    agentSessions: useCollection("agentSessions"),
    locations: useCollection("locations"),
    transfers: useCollection("transfers"),
    shipments: useCollection("shipments"),
    quotes: useCollection("quotes"),
    channelTombstones: useCollection("channelTombstones"),
  };
  const [selected, setSelected] = useState<Set<DatasetId>>(() => new Set<DatasetId>(["items"]));
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [scopeMode, setScopeMode] = useState<ScopeMode>("all");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [skuText, setSkuText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPageContext({ page: "Exports" });
  }, [setPageContext]);

  const onSkusParam = useCallback((v: string) => {
    setSkuText(v.split(",").map((x) => x.trim()).filter(Boolean).join("\n"));
    setScopeMode("skus");
  }, []);
  const onDatasetParam = useCallback((v: string) => {
    const ids = v.split(",").map((x) => x.trim()).filter((x) => datasetById(x)) as DatasetId[];
    if (ids.length) setSelected(new Set(ids));
  }, []);

  const categories = useMemo(() => Array.from(new Set(items.map((i) => i.category).filter((c): c is string => !!c))).sort(), [items]);
  const scope = useMemo<ItemScope>(() => {
    if (scopeMode === "all") return {};
    if (scopeMode === "filter") return { itemIds: new Set(items.filter((i) => (!category || i.category === category) && (!status || i.status === status)).map((i) => i.id)) };
    const wanted = new Set(skuText.split(/[\n,;\t]+/).map((s) => s.trim().toUpperCase()).filter(Boolean));
    return { itemIds: new Set(items.filter((i) => wanted.has(i.sku.toUpperCase()) || (i.barcode && wanted.has(i.barcode.toUpperCase()))).map((i) => i.id)) };
  }, [scopeMode, items, category, status, skuText]);
  const unknownSkus = useMemo(() => {
    if (scopeMode !== "skus") return [] as string[];
    const known = new Set(items.flatMap((i) => [i.sku.toUpperCase(), ...(i.barcode ? [i.barcode.toUpperCase()] : [])]));
    return skuText.split(/[\n,;\t]+/).map((s) => s.trim()).filter((s) => s && !known.has(s.toUpperCase()));
  }, [scopeMode, skuText, items]);

  const source: ExportSource = { data, settings };
  const chosen = DATASETS.filter((d) => selected.has(d.id));
  const totalRows = chosen.reduce((a, d) => a + d.count(source, scope), 0);
  const scopedItems = scope.itemIds ? scope.itemIds.size : items.length;

  const toggle = (id: DatasetId) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = () => {
    if (chosen.length === 0) return toast("Pick at least one dataset", "critical");
    setBusy(true);
    try {
      const tables = buildTables(chosen, source, scope);
      const res = exportTables(tables, format, `${settings.companyName.replace(/[^\w-]+/g, "-").toLowerCase() || "cumulus"}-export`);
      if (res.note === "blocked") toast("Allow pop-ups to open the print view", "critical");
      else if (res.note === "print") toast("Print view opened. Choose Save as PDF in the dialog.", "success");
      else toast(`Exported ${pluralize(totalRows, "row")} across ${pluralize(chosen.length, "dataset")}${res.note === "zipped" ? " as a zip" : ""}`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Export failed", "critical");
    } finally {
      setBusy(false);
    }
  };

  const preview = chosen[0] ? chosen[0].build(source, scope) : null;

  return (
    <Page title="Exports" subtitle="Take the workspace with you: every dataset as CSV, Excel, JSON, Markdown or PDF, for the whole company or a set of SKUs.">
      <Suspense fallback={null}>
        <QueryParamEffect param="skus" onValue={onSkusParam} />
        <QueryParamEffect param="dataset" onValue={onDatasetParam} />
      </Suspense>
      <div className="grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-4">
          <div className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[13.5px] font-semibold text-text">Datasets</h3>
              <div className="flex gap-2 text-[12px]">
                <button type="button" className="text-accent hover:underline" onClick={() => setSelected(new Set(DATASETS.map((d) => d.id)))}>
                  All
                </button>
                <button type="button" className="text-accent hover:underline" onClick={() => setSelected(new Set())}>
                  None
                </button>
              </div>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {DATASETS.map((d) => {
                const n = d.count(source, scope);
                return (
                  <label key={d.id} className={cn("flex cursor-pointer items-start gap-2 rounded-[var(--radius-sm)] border px-2.5 py-2", selected.has(d.id) ? "border-accent/40 bg-accent-soft/30" : "border-border hover:bg-surface-hover")}>
                    <Checkbox checked={selected.has(d.id)} onChange={() => toggle(d.id)} aria-label={d.label} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2 text-[12.5px] font-medium text-text">
                        {d.label}
                        <span className="text-[11px] font-normal text-text-tertiary">{formatNumber(n)}</span>
                      </span>
                      <span className="block text-[11.5px] text-text-secondary">{d.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="card p-4">
            <h3 className="mb-2 text-[13.5px] font-semibold text-text">Which items</h3>
            <Segmented<ScopeMode> value={scopeMode} onChange={setScopeMode} options={[{ value: "all", label: "Whole company" }, { value: "filter", label: "By filter" }, { value: "skus", label: "Specific SKUs" }]} />
            {scopeMode === "filter" && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Select value={category} onChange={(e) => setCategory(e.target.value)} placeholder="All categories" options={categories.map((c) => ({ value: c, label: c }))} containerClassName="w-48" aria-label="Category" />
                <Select value={status} onChange={(e) => setStatus(e.target.value)} placeholder="Any status" options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }, { value: "superseded", label: "Superseded" }]} containerClassName="w-40" aria-label="Status" />
              </div>
            )}
            {scopeMode === "skus" && (
              <div className="mt-3">
                <TextArea rows={5} value={skuText} onChange={(e) => setSkuText(e.target.value)} placeholder={"One SKU or barcode per line, or comma-separated.\nTip: select rows on the Inventory page and choose Export."} />
                {unknownSkus.length > 0 && <p className="mt-1 text-[12px] text-warning">Not found: {unknownSkus.slice(0, 8).join(", ")}{unknownSkus.length > 8 ? ` and ${unknownSkus.length - 8} more` : ""}</p>}
              </div>
            )}
            <p className="mt-2 text-[12px] text-text-tertiary">{scopeMode === "all" ? "Every item, and everything that references items." : `${pluralize(scopedItems, "item")} in scope. Ledger rows, orders, receipts, quotes and the rest are narrowed to them.`}</p>
          </div>

          {preview && (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-border px-4 py-2 text-[12.5px]">
                <span className="font-semibold text-text">Preview · {chosen[0]!.label}</span>
                <span className="text-text-tertiary">
                  {preview.headers.length} columns · {formatNumber(preview.rows.length)} rows
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11.5px]">
                  <thead className="bg-surface-subdued text-text-secondary">
                    <tr>
                      {preview.headers.map((h) => (
                        <th key={h} className="whitespace-nowrap px-2 py-1 text-left font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 5).map((r, i) => (
                      <tr key={i} className="border-t border-border">
                        {r.map((c, j) => (
                          <td key={j} className="max-w-[200px] truncate whitespace-nowrap px-2 py-1 text-text-secondary">
                            {c === null || c === undefined ? "" : String(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {preview.rows.length === 0 && (
                      <tr>
                        <td colSpan={preview.headers.length} className="px-2 py-4 text-center text-text-tertiary">
                          No rows in scope
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="card p-4">
            <h3 className="mb-2 text-[13.5px] font-semibold text-text">Format</h3>
            <div className="flex flex-col gap-1">
              {FORMATS.map((f) => (
                <label key={f.value} className={cn("flex cursor-pointer items-start gap-2 rounded-[var(--radius-sm)] border px-2.5 py-2", format === f.value ? "border-accent/40 bg-accent-soft/30" : "border-border hover:bg-surface-hover")}>
                  <input type="radio" name="format" className="mt-0.5 accent-[var(--accent)]" checked={format === f.value} onChange={() => setFormat(f.value)} />
                  <span>
                    <span className="block text-[12.5px] font-medium text-text">{f.label}</span>
                    <span className="block text-[11.5px] text-text-secondary">{f.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="card p-4">
            <div className="mb-3 text-[12.5px] text-text-secondary">
              {pluralize(chosen.length, "dataset")} · {formatNumber(totalRows)} rows · {scopeMode === "all" ? "whole company" : pluralize(scopedItems, "item")}
            </div>
            <Button variant="primary" icon={format === "pdf" ? <Upload /> : <Download />} onClick={run} loading={busy} disabled={chosen.length === 0} className="w-full">
              {format === "pdf" ? "Open print view" : `Export ${FORMATS.find((f) => f.value === format)?.label}`}
            </Button>
            <p className="mt-2 text-[11.5px] text-text-tertiary">Files are built in your browser from the live workspace. Nothing is uploaded anywhere.</p>
          </div>
          <Banner tone="info" title="Full backup">
            The complete workspace as one JSON file, including settings, lives under Settings → Data and backend. It restores on any Cumulus install.
          </Banner>
        </div>
      </div>
    </Page>
  );
}
