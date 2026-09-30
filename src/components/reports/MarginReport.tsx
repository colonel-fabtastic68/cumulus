"use client";

import { useMemo, useState } from "react";
import { Percent } from "lucide-react";
import { marginReport, type MarginRow } from "@/lib/margins";
import { useCollection, useItems, useSettings } from "@/lib/store/provider";
import { formatMoney, formatNumber, formatPercent, pluralize } from "@/lib/format";
import { Badge, SearchField, Select, Stat, Table, type BadgeTone, type Column } from "@/components/ui";
import { matches } from "@/lib/utils";
import { downloadCsv } from "./csv";
import { AskAgentButton, ExportCsvButton, ReportEmpty, ReportHeader, ReportSubheader, SkuLink, WINDOW_OPTIONS } from "./shared";

function marginTone(pct: number | null): BadgeTone {
  if (pct === null) return "default";
  if (pct < 0) return "critical";
  if (pct < 0.2) return "warning";
  if (pct < 0.4) return "default";
  return "success";
}

/** What each part earned: shipped units at the order price against the cost booked when they left the shelf. */
export function MarginReport() {
  const items = useItems();
  const orders = useCollection("orders");
  const movements = useCollection("movements");
  const { currency } = useSettings();
  const [days, setDays] = useState("90");
  const [q, setQ] = useState("");

  const report = useMemo(() => marginReport(items, orders, movements, Number(days)), [items, orders, movements, days]);
  const rows = useMemo(() => (q.trim() ? report.rows.filter((r) => matches(q, r.item.sku, r.item.name, r.item.category)) : report.rows), [report, q]);

  const columns = useMemo<Column<MarginRow>[]>(
    () => [
      { key: "sku", header: "SKU", render: (r) => <SkuLink item={r.item} />, sortValue: (r) => r.item.sku, width: "150px" },
      { key: "name", header: "Item", render: (r) => <span className="block max-w-[260px] truncate">{r.item.name}</span>, sortValue: (r) => r.item.name },
      { key: "category", header: "Category", render: (r) => r.item.category ?? <span className="text-text-tertiary">—</span>, sortValue: (r) => r.item.category ?? "", hideBelow: "lg" },
      { key: "units", header: "Units sold", align: "right", render: (r) => <span className="tabular">{formatNumber(r.units)}</span>, sortValue: (r) => r.units },
      { key: "revenue", header: "Revenue", align: "right", render: (r) => <span className="tabular">{formatMoney(r.revenue, currency)}</span>, sortValue: (r) => r.revenue },
      { key: "cogs", header: "Cost of goods", align: "right", render: (r) => <span className="tabular text-text-secondary">{formatMoney(r.cogs, currency)}</span>, sortValue: (r) => r.cogs, hideBelow: "md" },
      { key: "margin", header: "Gross margin", align: "right", render: (r) => <span className={`font-medium tabular ${r.margin < 0 ? "text-critical" : "text-text"}`}>{formatMoney(r.margin, currency)}</span>, sortValue: (r) => r.margin },
      { key: "marginPct", header: "Margin %", align: "right", render: (r) => <Badge tone={marginTone(r.marginPct)}>{r.marginPct === null ? "—" : formatPercent(r.marginPct * 100)}</Badge>, sortValue: (r) => r.marginPct ?? -Infinity },
      { key: "avgPrice", header: "Avg price", align: "right", render: (r) => <span className="tabular text-text-secondary">{r.avgPrice === null ? "—" : formatMoney(r.avgPrice, currency)}</span>, sortValue: (r) => r.avgPrice ?? 0, hideBelow: "lg" },
      { key: "avgCost", header: "Avg cost", align: "right", render: (r) => <span className="tabular text-text-secondary">{r.avgCost === null ? "—" : formatMoney(r.avgCost, currency)}</span>, sortValue: (r) => r.avgCost ?? 0, hideBelow: "lg" },
      {
        key: "listMargin",
        header: "At list price now",
        align: "right",
        render: (r) => (r.listMarginPct === null ? <span className="text-text-tertiary">—</span> : <span className={`tabular ${r.listMarginPct < 0 ? "text-critical" : "text-text-secondary"}`}>{formatPercent(r.listMarginPct * 100)}</span>),
        sortValue: (r) => r.listMarginPct ?? -Infinity,
        hideBelow: "lg",
      },
    ],
    [currency],
  );

  const exportCsv = () => {
    downloadCsv(
      "margins.csv",
      ["SKU", "Item", "Category", "Units sold", "Revenue", "Cost of goods", "Gross margin", "Margin %", "Avg price", "Avg cost", "Margin at list %", "Orders"],
      rows.map((r) => [r.item.sku, r.item.name, r.item.category ?? "", r.units, r.revenue, r.cogs, r.margin, r.marginPct === null ? "" : Math.round(r.marginPct * 1000) / 10, r.avgPrice ?? "", r.avgCost ?? "", r.listMarginPct === null ? "" : Math.round(r.listMarginPct * 1000) / 10, r.orders]),
    );
  };

  const t = report.total;
  const prompt = `Review profitability over the last ${days} days: total revenue ${formatMoney(t.revenue, currency)}, cost of goods ${formatMoney(t.cogs, currency)}, gross margin ${formatMoney(t.margin, currency)}. Which parts are dragging margin down, which are carrying it, and where should prices or costs change? Use the sales and consumption data.`;

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title="Margins"
        description="What each part actually earned: units that left the shelf for an order in the window, at the price on that order, against the cost booked when they left. Assemblies built to order are costed at their rolled-up BOM cost."
        actions={
          <>
            <Select value={days} onChange={(e) => setDays(e.target.value)} options={WINDOW_OPTIONS} aria-label="Window" />
            <ExportCsvButton onExport={exportCsv} disabled={rows.length === 0} />
            <AskAgentButton prompt={prompt} disabled={report.rows.length === 0} />
          </>
        }
      />
      <div className="grid grid-cols-1 gap-3 @md:grid-cols-4">
        <Stat label="Revenue" value={formatMoney(t.revenue, currency)} hint={`${pluralize(t.units, "unit")} shipped`} />
        <Stat label="Cost of goods" value={formatMoney(t.cogs, currency)} hint="At the cost when shipped" />
        <Stat label="Gross margin" value={formatMoney(t.margin, currency)} tone={t.margin < 0 ? "critical" : "success"} hint={`${pluralize(t.items, "part")} sold`} />
        <Stat label="Margin" value={t.marginPct === null ? "—" : formatPercent(t.marginPct * 100)} tone={t.marginPct === null ? "default" : t.marginPct < 0.2 ? "warning" : "success"} icon={<Percent />} hint="Of revenue" />
      </div>
      {report.rows.length === 0 ? (
        <ReportEmpty icon={<Percent />} title="Nothing shipped in this window" description="Margins appear once orders ship. Widen the window, or ship an order." />
      ) : (
        <>
          {report.byCategory.length > 1 && (
            <div className="flex flex-col gap-2">
              <ReportSubheader title="By category" />
              <div className="overflow-x-auto rounded-[var(--radius)] border border-border">
                <table className="w-full text-[13px]">
                  <thead className="bg-surface-subdued text-[11.5px] uppercase tracking-wide text-text-tertiary">
                    <tr>
                      <th className="px-3 py-1.5 text-left">Category</th>
                      <th className="px-3 py-1.5 text-right">Parts</th>
                      <th className="px-3 py-1.5 text-right">Units</th>
                      <th className="px-3 py-1.5 text-right">Revenue</th>
                      <th className="px-3 py-1.5 text-right">Cost of goods</th>
                      <th className="px-3 py-1.5 text-right">Gross margin</th>
                      <th className="px-3 py-1.5 text-right">Margin %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byCategory.map((g) => (
                      <tr key={g.key} className="border-t border-border">
                        <td className="px-3 py-1.5">{g.label}</td>
                        <td className="px-3 py-1.5 text-right tabular">{g.items}</td>
                        <td className="px-3 py-1.5 text-right tabular">{formatNumber(g.units)}</td>
                        <td className="px-3 py-1.5 text-right tabular">{formatMoney(g.revenue, currency)}</td>
                        <td className="px-3 py-1.5 text-right tabular text-text-secondary">{formatMoney(g.cogs, currency)}</td>
                        <td className={`px-3 py-1.5 text-right tabular font-medium ${g.margin < 0 ? "text-critical" : ""}`}>{formatMoney(g.margin, currency)}</td>
                        <td className="px-3 py-1.5 text-right">
                          <Badge tone={marginTone(g.marginPct)}>{g.marginPct === null ? "—" : formatPercent(g.marginPct * 100)}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <Table
            rows={rows}
            columns={columns}
            rowKey={(r) => r.item.id}
            dense
            pageSize={100}
            defaultSort={{ key: "margin", dir: "desc" }}
            toolbar={<SearchField value={q} onChange={setQ} placeholder="Search SKU, name or category" className="w-full sm:w-72" />}
            footer={`${pluralize(rows.length, "part")} · revenue ${formatMoney(rows.reduce((s, r) => s + r.revenue, 0), currency)} · gross margin ${formatMoney(rows.reduce((s, r) => s + r.margin, 0), currency)}`}
          />
          <p className="text-[12px] text-text-tertiary">Revenue counts units that shipped; open orders are not included. Shipping charges, discounts applied outside the order and payment fees are not part of cost of goods.</p>
        </>
      )}
    </div>
  );
}
