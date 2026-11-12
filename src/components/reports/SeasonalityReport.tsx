"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { Item } from "@/lib/types";
import { seasonalityReport } from "@/lib/inventory";
import { useCollection, useItems } from "@/lib/store/provider";
import { useFeature } from "@/lib/useFeature";
import { useTerms } from "@/lib/useTerms";
import { formatNumber } from "@/lib/format";
import { round, sum } from "@/lib/utils";
import { Button, Card, CardHeader, Select, Table, type Column } from "@/components/ui";
import { ItemPicker } from "@/components/inventory";
import { csvFilename, downloadCsv } from "./csv";
import { AskAgentButton, Dash, ExportCsvButton, ReportHeader, ReportSubheader } from "./shared";
import { ChartLegend, SeasonalityChart, monthLabel, type SeasonalityPoint } from "./SeasonalityChart";

const MONTHS = 12;

const anyItem = () => true;

export function SeasonalityReport() {
  const movements = useCollection("movements");
  const [focus, setFocus] = useState<Item | null>(null);
  // Feature "seasonalityFilters": several part numbers at once, or everything in chosen categories.
  const filters = useFeature("seasonalityFilters");
  const terms = useTerms();
  const items = useItems();
  const [picked, setPicked] = useState<Item[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const allCategories = useMemo(() => Array.from(new Set(items.map((i) => i.category).filter((c): c is string => !!c))).sort((a, b) => a.localeCompare(b)), [items]);
  const scope = useMemo(() => {
    if (!filters) return focus?.id;
    if (picked.length === 0 && categories.length === 0) return undefined;
    const wanted = new Set(categories);
    return new Set([...picked.map((i) => i.id), ...items.filter((i) => i.category && wanted.has(i.category)).map((i) => i.id)]);
  }, [filters, focus?.id, picked, categories, items]);
  const scoped = filters && (picked.length > 0 || categories.length > 0);
  const clearScope = () => {
    setPicked([]);
    setCategories([]);
  };

  const data = useMemo<SeasonalityPoint[]>(() => seasonalityReport(movements, MONTHS, scope), [movements, scope]);
  const totals = useMemo(() => {
    const sold = round(sum(data.map((d) => d.sold)), 2);
    const consumed = round(sum(data.map((d) => d.consumed)), 2);
    return { sold, consumed, total: round(sold + consumed, 2), avg: round((sold + consumed) / Math.max(1, data.length), 1) };
  }, [data]);
  const hasData = totals.total > 0;

  const columns = useMemo<Column<SeasonalityPoint>[]>(
    () => [
      { key: "month", header: "Month", render: (d) => <span className="font-medium text-text">{monthLabel(d.month)}</span> },
      { key: "sold", header: "Sold", align: "right", render: (d) => (d.sold ? formatNumber(d.sold, 2) : <Dash />), sortValue: (d) => d.sold },
      { key: "consumed", header: "Consumed in builds", align: "right", render: (d) => (d.consumed ? formatNumber(d.consumed, 2) : <Dash />), sortValue: (d) => d.consumed },
      { key: "total", header: "Total usage", align: "right", render: (d) => <span className="font-medium text-text">{formatNumber(d.sold + d.consumed, 2)}</span>, sortValue: (d) => d.sold + d.consumed },
      {
        key: "vsAvg",
        header: "vs. monthly avg",
        align: "right",
        hideBelow: "sm",
        render: (d) => {
          if (totals.avg <= 0) return <Dash />;
          const pct = ((d.sold + d.consumed) / totals.avg - 1) * 100;
          return <span className={pct > 0 ? "text-success" : pct < 0 ? "text-text-secondary" : undefined}>{`${pct > 0 ? "+" : ""}${formatNumber(pct, 0)}%`}</span>;
        },
        sortValue: (d) => (totals.avg > 0 ? (d.sold + d.consumed) / totals.avg : null),
      },
    ],
    [totals.avg],
  );

  const pickedLabel = picked.length === 1 ? `${picked[0]!.sku} · ${picked[0]!.name}` : picked.length > 1 ? `${picked.length} ${terms.itemCodes.toLowerCase()}` : "";
  const categoryLabel = categories.length === 1 ? categories[0]! : categories.length > 1 ? `${categories.length} categories` : "";
  const scopeLabel = filters ? [pickedLabel, categoryLabel].filter(Boolean).join(" + ") || "All items" : focus ? `${focus.sku} · ${focus.name}` : "All items";
  const fileScope = filters ? (scoped ? (picked.length === 1 && categories.length === 0 ? picked[0]!.sku.toLowerCase() : "selection") : "") : (focus?.sku.toLowerCase() ?? "");

  const exportCsv = () =>
    downloadCsv(
      csvFilename(fileScope ? `seasonality-${fileScope}` : "seasonality"),
      ["Month", "Sold", "Consumed in builds", "Total usage"],
      data.map((d) => [d.month, d.sold, d.consumed, round(d.sold + d.consumed, 2)]),
    );

  const agentPrompt = scoped
    ? `Project next month's demand for ${[picked.length ? picked.slice(0, 20).map((i) => i.sku).join(", ") : "", categories.length ? `the ${categories.join(", ")} ${categories.length === 1 ? "category" : "categories"}` : ""].filter(Boolean).join(" and ")} using the last ${MONTHS} months of sales and build consumption. Call out the seasonality you see and give a reorder recommendation.`
    : focus
    ? `Project next month's demand for ${focus.sku} (${focus.name}) using the last ${MONTHS} months of sales and build consumption. Call out the seasonality you see and give a reorder recommendation.`
    : `Project next month's demand for each finished good using the last ${MONTHS} months of sales and build consumption. Call out the seasonality you see and which components it puts under pressure.`;

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title="Seasonality"
        description={`Units sold and units consumed by builds, month by month for the last ${MONTHS} months. ${filters ? `Narrow it to chosen ${terms.itemCodes.toLowerCase()} or categories to see their own curve.` : "Focus on a single item to see its own curve."}`}
        actions={
          <>
            <ExportCsvButton onExport={exportCsv} disabled={!hasData} />
            <AskAgentButton prompt={agentPrompt} label="Project next month" disabled={!hasData} />
          </>
        }
      />

      {filters ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <ItemPicker label={`Add ${terms.itemCodes.toLowerCase()}`} value={null} onChange={(item) => item && setPicked((cur) => (cur.some((i) => i.id === item.id) ? cur : [...cur, item]))} filter={anyItem} exclude={picked.map((i) => i.id)} className="w-full sm:w-96" placeholder={`Search a ${terms.itemCodeShort} or name to add it`} />
            <Select
              label="Add a category"
              value=""
              onChange={(e) => e.target.value && setCategories((cur) => (cur.includes(e.target.value) ? cur : [...cur, e.target.value]))}
              placeholder={allCategories.length ? "Choose a category" : "No categories yet"}
              options={allCategories.filter((c) => !categories.includes(c)).map((c) => ({ value: c, label: c }))}
              containerClassName="w-full sm:w-56"
              className="text-text"
              disabled={allCategories.length === 0}
            />
            {scoped && (
              <Button variant="plain" size="md" icon={<X />} onClick={clearScope}>
                Show all items
              </Button>
            )}
          </div>
          {scoped && (
            <div className="flex flex-wrap items-center gap-1.5">
              {categories.map((c) => (
                <Chip key={`c:${c}`} label={c} hint="Category" onRemove={() => setCategories((cur) => cur.filter((x) => x !== c))} />
              ))}
              {picked.map((i) => (
                <Chip key={i.id} label={i.sku} hint={i.name} mono onRemove={() => setPicked((cur) => cur.filter((x) => x.id !== i.id))} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          <ItemPicker label="Focus on an item" value={focus} onChange={setFocus} filter={anyItem} className="w-full sm:w-96" placeholder="All items · search a SKU to focus" />
          {focus && (
            <Button variant="plain" size="md" icon={<X />} onClick={() => setFocus(null)}>
              Show all items
            </Button>
          )}
        </div>
      )}

      <Card>
        <CardHeader title={`Sold vs. consumed · ${scopeLabel}`} subtitle={hasData ? `${formatNumber(totals.total, 2)} units over ${MONTHS} months, about ${formatNumber(totals.avg, 1)} a month` : "No sales or build consumption in this period."} actions={<ChartLegend />} />
        <SeasonalityChart data={data} label={`Monthly units sold and consumed in builds, ${scopeLabel}`} />
      </Card>

      <section className="flex flex-col gap-2">
        <ReportSubheader title="By month" />
        <Table
          rows={data}
          columns={columns}
          rowKey={(d) => d.month}
          pageSize={MONTHS}
          dense
          footer={
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>
                Sold <span className="font-semibold text-text tabular">{formatNumber(totals.sold, 2)}</span>
              </span>
              <span>
                Consumed <span className="font-semibold text-text tabular">{formatNumber(totals.consumed, 2)}</span>
              </span>
              <span>
                Total <span className="font-semibold text-text tabular">{formatNumber(totals.total, 2)}</span>
              </span>
              <span>
                Monthly avg <span className="font-semibold text-text tabular">{formatNumber(totals.avg, 1)}</span>
              </span>
            </span>
          }
        />
      </section>

      <p className="text-[12.5px] text-text-secondary">Use this to shape projections; Strato can project next month when asked.</p>
    </div>
  );
}

/** One part number or category in the report's scope, with a way to take it out again. */
function Chip({ label, hint, mono, onRemove }: { label: string; hint?: string; mono?: boolean; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-fill-tertiary py-0.5 pl-2.5 pr-1 text-[12.5px] text-text" title={hint}>
      <span className={mono ? "truncate font-mono text-[12px]" : "truncate"}>{label}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${label}`} className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-surface-hover hover:text-text">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
