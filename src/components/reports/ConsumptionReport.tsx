"use client";

import { useMemo, useState } from "react";
import { Activity } from "lucide-react";
import { consumptionReport, type ConsumptionRow } from "@/lib/inventory";
import { useCollection, useItems, useSettings } from "@/lib/store/provider";
import { formatNumber, formatQty, pluralize } from "@/lib/format";
import { matches, round, sum } from "@/lib/utils";
import { Badge, SearchField, Segmented, Select, Table, type Column } from "@/components/ui";
import { csvFilename, downloadCsv } from "./csv";
import { AskAgentButton, Dash, ExportCsvButton, ReportEmpty, ReportHeader, SkuLink, WINDOW_OPTIONS } from "./shared";

type Scope = "all" | "fg" | "parts";

const FINISHED_GOODS = "Finished goods";

function inScope(r: ConsumptionRow, scope: Scope): boolean {
  if (scope === "fg") return r.item.category === FINISHED_GOODS;
  if (scope === "parts") return r.item.type === "part";
  return true;
}

/** Days until on-hand runs out at the window's average daily usage; null when nothing was used. */
function daysOfCover(r: ConsumptionRow, days: number): number | null {
  if (r.totalUsage <= 0) return null;
  return Math.floor(r.item.onHand / (r.totalUsage / days));
}

export function ConsumptionReport() {
  const items = useItems();
  const movements = useCollection("movements");
  const { companyName } = useSettings();

  const [q, setQ] = useState("");
  const [windowValue, setWindowValue] = useState("90");
  const [scope, setScope] = useState<Scope>("all");
  const days = Number(windowValue);

  const all = useMemo(() => consumptionReport(items, movements, days), [items, movements, days]);
  const searched = useMemo(() => all.filter((r) => matches(q, r.item.sku, r.item.name, r.item.category)), [all, q]);
  const counts = useMemo(() => ({ all: searched.length, fg: searched.filter((r) => inScope(r, "fg")).length, parts: searched.filter((r) => inScope(r, "parts")).length }), [searched]);
  const rows = useMemo(() => searched.filter((r) => inScope(r, scope)), [searched, scope]);

  const totals = useMemo(
    () => ({
      sold: round(sum(rows.map((r) => r.sold)), 2),
      consumed: round(sum(rows.map((r) => r.consumedInBuilds)), 2),
      writtenOff: round(sum(rows.map((r) => r.writtenOff)), 2),
      returned: round(sum(rows.map((r) => r.returned)), 2),
      usage: round(sum(rows.map((r) => r.totalUsage)), 2),
    }),
    [rows],
  );

  const columns = useMemo<Column<ConsumptionRow>[]>(
    () => [
      { key: "sku", header: "SKU", width: "150px", render: (r) => <SkuLink item={r.item} />, sortValue: (r) => r.item.sku },
      {
        key: "name",
        header: "Item",
        render: (r) => (
          <span className="block max-w-[260px] truncate" title={r.item.name}>
            {r.item.name}
          </span>
        ),
        sortValue: (r) => r.item.name,
      },
      { key: "sold", header: "Sold", align: "right", render: (r) => (r.sold ? formatNumber(r.sold, 2) : <Dash />), sortValue: (r) => r.sold },
      { key: "consumed", header: "Consumed in builds", align: "right", render: (r) => (r.consumedInBuilds ? formatNumber(r.consumedInBuilds, 2) : <Dash />), sortValue: (r) => r.consumedInBuilds },
      { key: "writtenOff", header: "Written off", align: "right", hideBelow: "md", render: (r) => (r.writtenOff ? <span className="text-critical">{formatNumber(r.writtenOff, 2)}</span> : <Dash />), sortValue: (r) => r.writtenOff },
      { key: "returned", header: "Returned", align: "right", hideBelow: "md", render: (r) => (r.returned ? formatNumber(r.returned, 2) : <Dash />), sortValue: (r) => r.returned },
      { key: "usage", header: "Total usage", align: "right", render: (r) => <span className="font-medium text-text">{formatQty(r.totalUsage, r.item.unit)}</span>, sortValue: (r) => r.totalUsage },
      { key: "onHand", header: "On hand", align: "right", render: (r) => formatQty(r.item.onHand, r.item.unit), sortValue: (r) => r.item.onHand },
      {
        key: "cover",
        header: "Days of cover",
        align: "right",
        render: (r) => {
          const cover = daysOfCover(r, days);
          if (cover === null) return <Dash />;
          const lead = r.item.leadTimeDays;
          return lead !== undefined && cover < lead ? <Badge tone="critical">{cover}d</Badge> : <span>{cover}d</span>;
        },
        sortValue: (r) => daysOfCover(r, days),
      },
    ],
    [days],
  );

  const exportCsv = () =>
    downloadCsv(
      csvFilename(`consumption-${days}d`),
      ["SKU", "Name", "Category", "Type", "Sold", "Consumed in builds", "Written off", "Returned", "Total usage", "Unit", "On hand", "Days of cover", "Lead time (days)"],
      rows.map((r) => [r.item.sku, r.item.name, r.item.category, r.item.type, r.sold, r.consumedInBuilds, r.writtenOff, r.returned, r.totalUsage, r.item.unit, r.item.onHand, daysOfCover(r, days), r.item.leadTimeDays]),
    );

  const agentPrompt = `Using the last ${days} days of consumption at ${companyName}, which items are at risk of running out before their lead time, and what should we reorder first? Explain the usage that drives each recommendation.`;

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title="Consumption"
        description="Usage by layer over the window: units sold directly, consumed by builds, written off (including negative counts and adjustments) and returned through RMAs. Total usage nets returns out. Days of cover divides on hand by the window's average daily usage."
        actions={
          <>
            <ExportCsvButton onExport={exportCsv} disabled={rows.length === 0} />
            <AskAgentButton prompt={agentPrompt} label="Ask Nimbus" disabled={all.length === 0} />
          </>
        }
      />

      {all.length === 0 && !q ? (
        <ReportEmpty icon={<Activity />} title="No movement in this window" description={`Nothing was sold, built, written off or returned in the last ${days} days. Try a wider window.`} />
      ) : (
        <Table
          rows={rows}
          columns={columns}
          rowKey={(r) => r.item.id}
          defaultSort={{ key: "usage", dir: "desc" }}
          pageSize={100}
          toolbar={
            <>
              <SearchField value={q} onChange={setQ} placeholder="Search SKU or name" className="w-full sm:w-64" />
              <Select value={windowValue} onChange={(e) => setWindowValue(e.target.value)} options={WINDOW_OPTIONS} containerClassName="w-40" aria-label="Window" />
              <Segmented
                value={scope}
                onChange={setScope}
                options={[
                  { value: "all", label: "All", count: counts.all },
                  { value: "fg", label: "Finished goods", count: counts.fg },
                  { value: "parts", label: "Parts", count: counts.parts },
                ]}
              />
            </>
          }
          emptyState={<span>No items match this filter.</span>}
          footer={
            <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>{pluralize(rows.length, "item")}</span>
              <span>
                Sold <span className="font-semibold text-text tabular">{formatNumber(totals.sold, 2)}</span>
              </span>
              <span>
                Consumed <span className="font-semibold text-text tabular">{formatNumber(totals.consumed, 2)}</span>
              </span>
              <span>
                Written off <span className="font-semibold text-text tabular">{formatNumber(totals.writtenOff, 2)}</span>
              </span>
              <span>
                Returned <span className="font-semibold text-text tabular">{formatNumber(totals.returned, 2)}</span>
              </span>
              <span>
                Total usage <span className="font-semibold text-text tabular">{formatNumber(totals.usage, 2)}</span>
              </span>
            </span>
          }
        />
      )}
    </div>
  );
}
