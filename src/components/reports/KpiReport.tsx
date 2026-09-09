"use client";

import { useMemo, useState } from "react";
import { FileDown } from "lucide-react";
import { kpiReport, type KpiRow } from "@/lib/kpis";
import { useCollection, useItems, useSettings } from "@/lib/store/provider";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { Button, EmptyState, Segmented, Table, type Column } from "@/components/ui";
import { downloadCsv } from "./csv";

type Period = "30" | "90" | "365";
type Level = "category" | "sku";

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "365", label: "12 months" },
];

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[12.5px] font-medium text-text-secondary">{label}</div>
      <div className="mt-1 text-[22px] font-semibold leading-7 text-text tabular">{value}</div>
      {hint && <div className="mt-0.5 text-[12px] text-text-tertiary">{hint}</div>}
    </div>
  );
}

const dash = <span className="text-text-tertiary">—</span>;

/** Factor 38: turnover, days on hand, fill rate and stockouts, company-wide and broken down. */
export function KpiReport() {
  const items = useItems();
  const movements = useCollection("movements");
  const orders = useCollection("orders");
  const shipments = useCollection("shipments");
  const { currency } = useSettings();
  const [period, setPeriod] = useState<Period>("90");
  const [level, setLevel] = useState<Level>("category");

  const report = useMemo(() => kpiReport(items, movements, orders, shipments, { days: Number(period) }), [items, movements, orders, shipments, period]);
  const c = report.company;
  const fr = c.fillRate;
  const rows: KpiRow[] = level === "category" ? report.byCategory : report.bySku;

  const columns = useMemo<Column<KpiRow>[]>(
    () => [
      { key: "label", header: level === "category" ? "Category" : "SKU", render: (r) => <span className={level === "sku" ? "font-mono text-[12px]" : ""}>{r.label}</span>, sortValue: (r) => r.label },
      { key: "units", header: "Units used", align: "right", render: (r) => <span className="tabular">{formatNumber(r.unitsUsed)}</span>, sortValue: (r) => r.unitsUsed },
      { key: "cogs", header: "Cost of use", align: "right", render: (r) => <span className="tabular">{formatMoney(r.cogs, currency)}</span>, sortValue: (r) => r.cogs },
      { key: "avg", header: "Avg inventory", align: "right", hideBelow: "md", render: (r) => <span className="tabular">{formatMoney(r.avgInventoryValue, currency)}</span>, sortValue: (r) => r.avgInventoryValue },
      { key: "turnover", header: "Turnover", align: "right", render: (r) => (r.turnover === null ? dash : <span className="tabular">{r.turnover.toFixed(1)}×</span>), sortValue: (r) => r.turnover ?? -1 },
      { key: "doh", header: "Days on hand", align: "right", render: (r) => (r.daysOnHand === null ? dash : <span className="tabular">{formatNumber(Math.round(r.daysOnHand))}</span>), sortValue: (r) => r.daysOnHand ?? -1 },
      { key: "stockouts", header: "Stockouts", align: "right", render: (r) => <span className={r.stockouts ? "font-medium text-warning tabular" : "tabular text-text-tertiary"}>{r.stockouts}</span>, sortValue: (r) => r.stockouts },
      { key: "ending", header: "Value now", align: "right", hideBelow: "lg", render: (r) => <span className="tabular">{formatMoney(r.endingValue, currency)}</span>, sortValue: (r) => r.endingValue },
    ],
    [currency, level],
  );

  const exportCsv = () => {
    downloadCsv(
      `kpis-${level}-${period}d.csv`,
      [level === "category" ? "Category" : "SKU", "Units used", "Cost of use", "Average inventory value", "Turnover", "Days on hand", "Stockouts", "Value now"],
      rows.map((r) => [r.label, r.unitsUsed, r.cogs, r.avgInventoryValue, r.turnover ?? "", r.daysOnHand ?? "", r.stockouts, r.endingValue]),
    );
  };

  const noActivity = c.unitsUsed === 0 && fr.orders === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented value={period} onChange={setPeriod} options={PERIODS} />
        <div className="flex items-center gap-2">
          <Segmented<Level> value={level} onChange={setLevel} options={[{ value: "category", label: "By category" }, { value: "sku", label: "By SKU" }]} />
          <Button icon={<FileDown />} onClick={exportCsv} disabled={rows.length === 0}>
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
        <Tile label="Inventory turnover" value={c.turnover === null ? "—" : `${c.turnover.toFixed(1)}×`} hint={c.turnover === null ? "No inventory value in the period" : "Annualised: cost of use ÷ average inventory"} />
        <Tile label="Days of inventory on hand" value={c.daysOnHand === null ? "—" : formatNumber(Math.round(c.daysOnHand))} hint={c.daysOnHand === null ? "Nothing sold or consumed" : `At the last ${period} days' pace`} />
        <Tile label="Fill rate" value={fr.unitRate === null ? "—" : formatPercent(fr.unitRate * 100, 0)} hint={fr.orders ? `${formatNumber(fr.unitsOnFirstShipment)} of ${formatNumber(fr.orderedUnits)} units on the first shipment · ${fr.linesInFull}/${fr.lines} lines in full` : "No orders in the period"} />
        <Tile label="Stockouts" value={formatNumber(c.stockouts)} hint={`${c.itemsOutOfStock} active item${c.itemsOutOfStock === 1 ? "" : "s"} out of stock with demand`} />
      </div>

      {noActivity ? (
        <div className="card">
          <EmptyState title="Nothing moved in this period" description="Turnover, days on hand and fill rate need sales, builds or shipments to measure. Widen the period or come back after the first orders ship." />
        </div>
      ) : (
        <Table rows={rows} columns={columns} rowKey={(r) => r.key} pageSize={level === "sku" ? 50 : 100} dense defaultSort={{ key: "cogs", dir: "desc" }} footer={`${rows.length} ${level === "category" ? "categories" : "SKUs"} · cost of use ${formatMoney(c.cogs, currency)} · average inventory ${formatMoney(c.avgInventoryValue, currency)}`} />
      )}
      <p className="text-[12px] text-text-tertiary">Cost of use is units sold or consumed in builds at their movement cost. Average inventory is time-weighted at standard cost. Fill rate counts units shipped on an order&apos;s first shipment against units ordered.</p>
    </div>
  );
}
