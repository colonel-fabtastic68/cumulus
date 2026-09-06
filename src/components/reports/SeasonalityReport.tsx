"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { Item } from "@/lib/types";
import { seasonalityReport } from "@/lib/inventory";
import { useCollection } from "@/lib/store/provider";
import { formatNumber } from "@/lib/format";
import { round, sum } from "@/lib/utils";
import { Button, Card, CardHeader, Table, type Column } from "@/components/ui";
import { ItemPicker } from "@/components/inventory";
import { csvFilename, downloadCsv } from "./csv";
import { AskAgentButton, Dash, ExportCsvButton, ReportHeader, ReportSubheader } from "./shared";
import { ChartLegend, SeasonalityChart, monthLabel, type SeasonalityPoint } from "./SeasonalityChart";

const MONTHS = 12;

const anyItem = () => true;

export function SeasonalityReport() {
  const movements = useCollection("movements");
  const [focus, setFocus] = useState<Item | null>(null);

  const data = useMemo<SeasonalityPoint[]>(() => seasonalityReport(movements, MONTHS, focus?.id), [movements, focus?.id]);
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

  const scopeLabel = focus ? `${focus.sku} · ${focus.name}` : "All items";

  const exportCsv = () =>
    downloadCsv(
      csvFilename(focus ? `seasonality-${focus.sku.toLowerCase()}` : "seasonality"),
      ["Month", "Sold", "Consumed in builds", "Total usage"],
      data.map((d) => [d.month, d.sold, d.consumed, round(d.sold + d.consumed, 2)]),
    );

  const agentPrompt = focus
    ? `Project next month's demand for ${focus.sku} (${focus.name}) using the last ${MONTHS} months of sales and build consumption. Call out the seasonality you see and give a reorder recommendation.`
    : `Project next month's demand for each finished good using the last ${MONTHS} months of sales and build consumption. Call out the seasonality you see and which components it puts under pressure.`;

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title="Seasonality"
        description={`Units sold and units consumed by builds, month by month for the last ${MONTHS} months. Focus on a single item to see its own curve.`}
        actions={
          <>
            <ExportCsvButton onExport={exportCsv} disabled={!hasData} />
            <AskAgentButton prompt={agentPrompt} label="Project next month" disabled={!hasData} />
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-2">
        <ItemPicker label="Focus on an item" value={focus} onChange={setFocus} filter={anyItem} className="w-full sm:w-96" placeholder="All items · search a SKU to focus" />
        {focus && (
          <Button variant="plain" size="md" icon={<X />} onClick={() => setFocus(null)}>
            Show all items
          </Button>
        )}
      </div>

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

      <p className="text-[12.5px] text-text-secondary">Use this to shape projections; Nimbus can project next month when asked.</p>
    </div>
  );
}
