"use client";

import { useEffect, useMemo, useState } from "react";
import { FileDown, Sparkles, TrendingUp } from "lucide-react";
import type { Item } from "@/lib/types";
import { DEFAULT_SCENARIO, project, type ProjectionScope, type Scenario, type ScenarioRequest } from "@/lib/projections";
import { useCollection, useItems, useSettings } from "@/lib/store/provider";
import { useAgent } from "@/components/agent/AgentProvider";
import { formatDate, formatMoney, formatNumber, pluralize } from "@/lib/format";
import { Banner, BarChart, Button, ChartCard, LineChart, Page, Segmented, Select, Stat, Table, TextField, Toggle, type Column } from "@/components/ui";
import { ItemPicker } from "@/components/inventory";
import { downloadCsv } from "@/components/reports/csv";

type ScopeKind = ProjectionScope["kind"];
const HORIZONS = [30, 90, 180, 365];

export default function ProjectionsPage() {
  const items = useItems();
  const movements = useCollection("movements");
  const { currency } = useSettings();
  const { setPageContext, open: openAgent } = useAgent();
  const [scopeKind, setScopeKind] = useState<ScopeKind>("company");
  const [category, setCategory] = useState("");
  const [item, setItem] = useState<Item | null>(null);
  const [scenario, setScenario] = useState<Scenario>(DEFAULT_SCENARIO);
  const [text, setText] = useState("");
  const [reading, setReading] = useState<{ tone: "info" | "critical"; text: string } | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    setPageContext({ page: "Projections", selectedSkus: item ? [item.sku] : undefined });
  }, [setPageContext, item]);

  const categories = useMemo(() => Array.from(new Set(items.map((i) => i.category ?? "Uncategorised"))).sort(), [items]);
  const scope = useMemo<ProjectionScope>(() => (scopeKind === "sku" && item ? { kind: "sku", itemId: item.id } : scopeKind === "category" && category ? { kind: "category", category } : { kind: "company" }), [scopeKind, item, category]);
  const result = useMemo(() => project(items, movements, scope, scenario), [items, movements, scope, scenario]);
  const s = result.summary;
  const todayIndex = result.splitIndex - 1;
  const fmtDay = (d: string) => formatDate(d);
  const fmtMonth = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString(undefined, { month: "short", year: "2-digit" });

  const stockoutIdx = (() => {
    const first = result.perItem.map((p) => p.stockoutDate).filter((d): d is string => !!d).sort()[0];
    return first ? result.dates.indexOf(first) : -1;
  })();

  const askScenario = async () => {
    if (!text.trim()) return;
    setAsking(true);
    setReading(null);
    try {
      const res = await fetch("/api/projections/scenario", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, current: scenario, categories, skus: items.map((i) => i.sku), today: new Date().toISOString().slice(0, 10) }) });
      const data = (await res.json()) as ScenarioRequest | { error: string };
      if (!res.ok || "error" in data) throw new Error("error" in data ? data.error : "Could not read the scenario");
      setScenario((cur) => ({
        horizonDays: clamp(data.horizonDays ?? cur.horizonDays, 7, 730),
        historyDays: clamp(data.historyDays ?? cur.historyDays, 14, 365),
        growthPct: data.growthPct ?? cur.growthPct,
        seasonality: data.seasonality ?? cur.seasonality,
        priceChangePct: data.priceChangePct ?? cur.priceChangePct,
        costChangePct: data.costChangePct ?? cur.costChangePct,
      }));
      if (data.scope?.kind === "sku") {
        const wanted = data.scope.sku.toUpperCase();
        const found = items.find((i) => i.sku.toUpperCase() === wanted);
        if (found) {
          setScopeKind("sku");
          setItem(found);
        }
      } else if (data.scope?.kind === "category") {
        const cat = categories.find((c) => c.toLowerCase() === (data.scope as { category: string }).category.toLowerCase());
        if (cat) {
          setScopeKind("category");
          setCategory(cat);
        }
      } else if (data.scope?.kind === "company") setScopeKind("company");
      setReading({ tone: "info", text: data.reading });
    } catch (e) {
      setReading({ tone: "critical", text: e instanceof Error ? e.message : "Could not read the scenario" });
    } finally {
      setAsking(false);
    }
  };

  const exportCsv = () => {
    downloadCsv(
      `projection-${scope.kind}.csv`,
      ["SKU", "Name", "On hand", "Daily usage", "Days of cover", "Stockout date", "Reorder by", "Reorder qty", "On hand at horizon", "Unit cost now", "Unit cost at horizon", "Price now", "Price at horizon"],
      result.perItem.map((p) => [p.item.sku, p.item.name, p.item.onHand, p.dailyUsage, p.daysOfCover ?? "", p.stockoutDate ?? "", p.reorderByDate ?? "", p.reorderQty, p.onHandAtHorizon, p.costNow, p.costAtHorizon, p.priceNow, p.priceAtHorizon]),
    );
  };

  const askNimbus = () => {
    const label = scope.kind === "sku" ? item?.sku : scope.kind === "category" ? category : "the whole company";
    openAgent(`Looking at the ${scenario.horizonDays}-day projection for ${label}: ${formatNumber(s.onHandNow)} units on hand now, ${s.dailyUsage} used per day${scenario.growthPct ? ` with ${scenario.growthPct}% growth` : ""}, ${s.daysOfCover ?? "∞"} days of cover, ${s.stockoutsWithinHorizon} stockout${s.stockoutsWithinHorizon === 1 ? "" : "s"} and ${s.reordersWithinHorizon} reorder${s.reordersWithinHorizon === 1 ? "" : "s"} within the horizon. `, { send: false });
  };

  const columns = useMemo<Column<(typeof result.perItem)[number]>[]>(
    () => [
      { key: "sku", header: "SKU", render: (p) => <span className="font-mono text-[12px]">{p.item.sku}</span>, sortValue: (p) => p.item.sku },
      { key: "name", header: "Item", render: (p) => <span className="block max-w-[220px] truncate text-text-secondary">{p.item.name}</span>, sortValue: (p) => p.item.name, hideBelow: "md" },
      { key: "onHand", header: "On hand", align: "right", render: (p) => <span className="tabular">{formatNumber(p.item.onHand)}</span>, sortValue: (p) => p.item.onHand },
      { key: "usage", header: "Per day", align: "right", render: (p) => <span className="tabular">{p.dailyUsage}</span>, sortValue: (p) => p.dailyUsage },
      { key: "cover", header: "Days of cover", align: "right", render: (p) => (p.daysOfCover === null ? <span className="text-text-tertiary">—</span> : <span className={p.daysOfCover < 14 ? "font-medium text-warning tabular" : "tabular"}>{p.daysOfCover}</span>), sortValue: (p) => p.daysOfCover ?? 1e9 },
      { key: "stockout", header: "Runs out", render: (p) => (p.stockoutDate ? <span className="text-critical">{formatDate(p.stockoutDate)}</span> : <span className="text-text-tertiary">Not within horizon</span>), sortValue: (p) => p.stockoutDate ?? "9999" },
      { key: "reorder", header: "Order by", render: (p) => (p.reorderByDate ? <span>{formatDate(p.reorderByDate)} · {formatNumber(p.reorderQty)}</span> : <span className="text-text-tertiary">—</span>), sortValue: (p) => p.reorderByDate ?? "9999", hideBelow: "sm" },
      { key: "horizon", header: `In ${scenario.horizonDays}d`, align: "right", render: (p) => <span className="tabular text-text-secondary">{formatNumber(p.onHandAtHorizon)}</span>, sortValue: (p) => p.onHandAtHorizon, hideBelow: "lg" },
      { key: "cost", header: "Cost → horizon", align: "right", render: (p) => <span className="tabular text-text-secondary">{formatMoney(p.costNow, currency)} → {formatMoney(p.costAtHorizon, currency)}</span>, sortValue: (p) => p.costAtHorizon - p.costNow, hideBelow: "lg" },
    ],
    [currency, scenario.horizonDays],
  );

  return (
    <Page
      title="Projections"
      subtitle="Where stock, demand, value and cost are heading, from the ledger's own history. Describe a scenario and Nimbus sets the dials."
      secondaryActions={
        <>
          <Button icon={<FileDown />} onClick={exportCsv} disabled={result.perItem.length === 0}>
            Export CSV
          </Button>
          <Button icon={<Sparkles />} onClick={askNimbus}>
            Ask Nimbus
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="card p-4">
          <div className="flex flex-wrap items-end gap-3">
            <Segmented<ScopeKind> value={scopeKind} onChange={setScopeKind} options={[{ value: "company", label: "Whole company" }, { value: "category", label: "Category" }, { value: "sku", label: "SKU" }]} />
            {scopeKind === "category" && <Select value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Choose a category" options={categories.map((c) => ({ value: c, label: c }))} containerClassName="w-56" aria-label="Category" />}
            {scopeKind === "sku" && (
              <div className="w-72">
                <ItemPicker value={item} onChange={setItem} placeholder="Search SKU or name" />
              </div>
            )}
            <span className="hidden flex-1 sm:block" />
            <Segmented<string> value={String(scenario.horizonDays)} onChange={(v) => setScenario((c) => ({ ...c, horizonDays: Number(v) }))} options={HORIZONS.map((h) => ({ value: String(h), label: h === 365 ? "1 year" : `${h} days` }))} />
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <TextField label="Demand growth %" type="number" step="any" value={String(scenario.growthPct)} onChange={(e) => setScenario((c) => ({ ...c, growthPct: Number(e.target.value) || 0 }))} containerClassName="w-36" />
            <TextField label="Price change %" type="number" step="any" value={String(scenario.priceChangePct)} onChange={(e) => setScenario((c) => ({ ...c, priceChangePct: Number(e.target.value) || 0 }))} containerClassName="w-36" />
            <TextField label="Cost change %" type="number" step="any" value={String(scenario.costChangePct)} onChange={(e) => setScenario((c) => ({ ...c, costChangePct: Number(e.target.value) || 0 }))} containerClassName="w-36" />
            <TextField label="History (days)" type="number" min={14} max={365} value={String(scenario.historyDays)} onChange={(e) => setScenario((c) => ({ ...c, historyDays: clamp(Number(e.target.value) || 90, 14, 365) }))} containerClassName="w-32" />
            <Toggle label="Seasonality" help="Shape by last year's months" checked={scenario.seasonality} onChange={(v) => setScenario((c) => ({ ...c, seasonality: v }))} />
          </div>
          <div className="mt-3 flex flex-col gap-2 rounded-[var(--radius)] border border-accent/30 bg-accent-soft/40 p-3 sm:flex-row sm:items-center">
            <Sparkles className="hidden h-4 w-4 shrink-0 text-accent sm:block" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void askScenario();
              }}
              placeholder="Describe a scenario: “what if orders grow 25% through the holidays” · “show ENC-125B for the next 6 months” · “costs up 8% next quarter”"
              className="h-8 flex-1 rounded-[var(--radius-sm)] border border-border bg-surface px-2.5 text-[13px] outline-none placeholder:text-text-tertiary focus:border-accent"
            />
            <Button size="sm" variant="primary" onClick={() => void askScenario()} loading={asking} disabled={!text.trim()}>
              Apply scenario
            </Button>
          </div>
          {reading && (
            <Banner tone={reading.tone} className="mt-2">
              {reading.text}
            </Banner>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
          <Stat label="On hand now" value={formatNumber(s.onHandNow)} hint={`${pluralize(s.items, "item")} in scope · ${formatMoney(s.valueNow, currency)}`} icon={<TrendingUp />} />
          <Stat label={`In ${scenario.horizonDays} days`} value={formatNumber(s.onHandAtHorizon)} hint={`${formatMoney(s.valueAtHorizon, currency)} at cost`} />
          <Stat label="Usage per day" value={s.dailyUsage.toFixed(2)} hint={s.daysOfCover === null ? "No usage in the history window" : `${s.daysOfCover} days of cover${s.seasonalityApplied ? " · seasonal" : ""}`} />
          <Stat label="Within horizon" value={`${s.stockoutsWithinHorizon} / ${s.reordersWithinHorizon}`} hint="stockouts / reorders due" tone={s.stockoutsWithinHorizon ? "warning" : "default"} />
        </div>

        <div className="grid gap-4 @3xl:grid-cols-2">
          <ChartCard title="Stock level" description={`${scenario.historyDays} days of history from the ledger, then ${scenario.horizonDays} days ahead at ${scenario.growthPct ? `${scenario.growthPct > 0 ? "+" : ""}${scenario.growthPct}% ` : ""}recent usage${s.seasonalityApplied ? ", seasonally shaped" : ""}.`}>
            <LineChart
              x={result.dates}
              formatX={fmtDay}
              format={(v) => formatNumber(v)}
              series={[
                { key: "onHand", label: "On hand", color: "var(--accent)", values: result.onHand, projectedFrom: result.splitIndex, area: true },
                ...(scope.kind === "sku" && item?.minQty !== undefined ? [{ key: "min", label: "Minimum", color: "var(--warning)", values: result.dates.map(() => item.minQty!), reference: true }] : []),
              ]}
              markers={[{ index: todayIndex, label: "Today" }, ...(stockoutIdx > 0 ? [{ index: stockoutIdx, label: "Runs out", tone: "critical" as const }] : [])]}
            />
          </ChartCard>
          <ChartCard title="Demand by month" description="Units sold or consumed in builds; outlined bars are projected.">
            <BarChart x={result.demand.labels} formatX={fmtMonth} format={(v) => formatNumber(v)} series={[{ key: "demand", label: "Units used", color: "var(--info)", values: result.demand.values, projectedFrom: result.demand.projectedFrom }]} />
          </ChartCard>
          <ChartCard title="Inventory value" description="On hand × unit cost, with the cost trend applied to the projection.">
            <LineChart x={result.dates} formatX={fmtDay} format={(v) => formatMoney(v, currency)} series={[{ key: "value", label: "Value at cost", color: "var(--success)", values: result.value, projectedFrom: result.splitIndex, area: true }]} markers={[{ index: todayIndex, label: "Today" }]} />
          </ChartCard>
          {scope.kind === "sku" && result.cost && result.price ? (
            <ChartCard title="Unit cost and price" description="Cost from receipts over time and its trend; list price with the price change applied.">
              <LineChart
                x={result.dates}
                formatX={fmtDay}
                format={(v) => formatMoney(v, currency)}
                series={[
                  { key: "cost", label: "Unit cost", color: "var(--warning)", values: result.cost, projectedFrom: result.splitIndex },
                  { key: "price", label: "List price", color: "var(--accent)", values: result.price, projectedFrom: result.splitIndex },
                ]}
                markers={[{ index: todayIndex, label: "Today" }]}
              />
            </ChartCard>
          ) : (
            <ChartCard title="Cost and price" description="Pick a single SKU to see its receipt-cost trend and list price over time.">
              <div className="flex h-[240px] items-center justify-center text-[12.5px] text-text-tertiary">Per-SKU view</div>
            </ChartCard>
          )}
        </div>

        <Table rows={result.perItem} columns={columns} rowKey={(p) => p.item.id} pageSize={25} dense defaultSort={{ key: "cover", dir: "asc" }} footer={`${pluralize(result.perItem.length, "item")} · sorted by days of cover`} />
        <p className="text-[12px] text-text-tertiary">Usage is sales and build consumption over the history window. Seasonality uses each month&apos;s share of the last 12 months when at least six months have data. Reorder dates place the order lead-time days before the projected level reaches the minimum. Nothing here changes stock.</p>
      </div>
    </Page>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
