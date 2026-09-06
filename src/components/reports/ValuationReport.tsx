"use client";

import { useMemo } from "react";
import { PackageOpen } from "lucide-react";
import type { Item } from "@/lib/types";
import { useItems, useSettings } from "@/lib/store/provider";
import { formatMoney, formatNumber, formatPercent, formatQty, pluralize } from "@/lib/format";
import { round, sum } from "@/lib/utils";
import { Stat, Table, type Column } from "@/components/ui";
import { csvFilename, downloadCsv } from "./csv";
import { AskAgentButton, ExportCsvButton, ReportEmpty, ReportHeader, ReportSubheader, ShareBar, SkuLink } from "./shared";

const TOP_N = 15;
const UNCATEGORISED = "Uncategorised";
const AGENT_PROMPT =
  "Summarise where inventory value is concentrated by category and by SKU, then suggest three concrete ways to reduce working capital without risking stock-outs on finished goods.";

interface ValuedItem {
  item: Item;
  value: number;
  /** Share of total inventory value, 0-100. */
  share: number;
}

interface CategoryRow {
  category: string;
  items: number;
  units: number;
  value: number;
  share: number;
}

export function ValuationReport() {
  const items = useItems();
  const { currency } = useSettings();

  const stocked = useMemo(() => items.filter((i) => i.onHand > 0), [items]);
  const totalValue = useMemo(() => round(sum(stocked.map((i) => i.onHand * i.unitCost))), [stocked]);
  const totalUnits = useMemo(() => round(sum(stocked.map((i) => i.onHand)), 2), [stocked]);

  const valued = useMemo<ValuedItem[]>(
    () =>
      stocked
        .map((item) => {
          const value = round(item.onHand * item.unitCost);
          return { item, value, share: totalValue > 0 ? (value / totalValue) * 100 : 0 };
        })
        .sort((a, b) => b.value - a.value || a.item.sku.localeCompare(b.item.sku)),
    [stocked, totalValue],
  );
  const top = useMemo(() => valued.slice(0, TOP_N), [valued]);
  const topShare = useMemo(() => sum(top.map((t) => t.share)), [top]);

  const byCategory = useMemo<CategoryRow[]>(() => {
    const map = new Map<string, CategoryRow>();
    for (const v of valued) {
      const key = v.item.category?.trim() || UNCATEGORISED;
      let row = map.get(key);
      if (!row) {
        row = { category: key, items: 0, units: 0, value: 0, share: 0 };
        map.set(key, row);
      }
      row.items += 1;
      row.units = round(row.units + v.item.onHand, 2);
      row.value = round(row.value + v.value);
    }
    for (const r of map.values()) r.share = totalValue > 0 ? (r.value / totalValue) * 100 : 0;
    return Array.from(map.values()).sort((a, b) => b.value - a.value || a.category.localeCompare(b.category));
  }, [valued, totalValue]);

  const categoryColumns = useMemo<Column<CategoryRow>[]>(
    () => [
      { key: "category", header: "Category", render: (r) => <span className="font-medium text-text">{r.category}</span>, sortValue: (r) => r.category },
      { key: "items", header: "Items", align: "right", render: (r) => formatNumber(r.items), sortValue: (r) => r.items },
      { key: "units", header: "Units", align: "right", hideBelow: "sm", render: (r) => formatNumber(r.units, 2), sortValue: (r) => r.units },
      { key: "value", header: "Value", align: "right", render: (r) => <span className="font-medium text-text">{formatMoney(r.value, currency)}</span>, sortValue: (r) => r.value },
      { key: "share", header: "Share", align: "right", width: "160px", render: (r) => <ShareBar pct={r.share} />, sortValue: (r) => r.share },
    ],
    [currency],
  );

  const topColumns = useMemo<Column<ValuedItem>[]>(
    () => [
      { key: "rank", header: "#", width: "40px", align: "right", render: (r) => <span className="text-text-tertiary">{top.indexOf(r) + 1}</span> },
      { key: "sku", header: "SKU", width: "150px", render: (r) => <SkuLink item={r.item} />, sortValue: (r) => r.item.sku },
      {
        key: "name",
        header: "Item",
        render: (r) => (
          <span className="block max-w-[280px] truncate" title={r.item.name}>
            {r.item.name}
          </span>
        ),
        sortValue: (r) => r.item.name,
      },
      { key: "category", header: "Category", hideBelow: "md", render: (r) => r.item.category ?? <span className="text-text-tertiary">{UNCATEGORISED}</span>, sortValue: (r) => r.item.category ?? "" },
      { key: "onHand", header: "On hand", align: "right", render: (r) => formatQty(r.item.onHand, r.item.unit), sortValue: (r) => r.item.onHand },
      { key: "unitCost", header: "Unit cost", align: "right", hideBelow: "sm", render: (r) => formatMoney(r.item.unitCost, currency), sortValue: (r) => r.item.unitCost },
      { key: "value", header: "Value", align: "right", render: (r) => <span className="font-medium text-text">{formatMoney(r.value, currency)}</span>, sortValue: (r) => r.value },
      { key: "share", header: "Share", align: "right", width: "160px", render: (r) => <ShareBar pct={r.share} />, sortValue: (r) => r.share },
    ],
    [currency, top],
  );

  const exportItems = () =>
    downloadCsv(
      csvFilename("valuation-items"),
      ["SKU", "Name", "Category", "Type", "Status", "On hand", "Unit", "Unit cost", "Value", "Share %"],
      valued.map((v) => [v.item.sku, v.item.name, v.item.category, v.item.type, v.item.status, v.item.onHand, v.item.unit, v.item.unitCost, v.value, round(v.share, 2)]),
    );

  const exportCategories = () =>
    downloadCsv(
      csvFilename("valuation-by-category"),
      ["Category", "Items", "Units", "Value", "Share %"],
      byCategory.map((r) => [r.category, r.items, r.units, r.value, round(r.share, 2)]),
    );

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title="Inventory valuation"
        description="What is on the shelf right now at standard unit cost. Assemblies are valued at their rolled-up cost. Items with zero or negative stock are left out."
        actions={
          <>
            <ExportCsvButton onExport={exportItems} disabled={valued.length === 0} />
            <AskAgentButton prompt={AGENT_PROMPT} label="Ask Nimbus" disabled={valued.length === 0} />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 @md:grid-cols-3">
        <Stat label="Total value" value={formatMoney(totalValue, currency)} hint="At standard cost" />
        <Stat label="Total units" value={formatNumber(totalUnits, 2)} hint="Across all units of measure" />
        <Stat label="SKUs with stock" value={formatNumber(stocked.length)} hint={`${pluralize(items.length - stocked.length, "SKU")} with nothing on hand`} />
      </div>

      {valued.length === 0 ? (
        <ReportEmpty icon={<PackageOpen />} title="Nothing on the shelf" description="Receive stock or set opening balances and the valuation will fill in here." />
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <ReportSubheader
              title="By category"
              description={`${pluralize(byCategory.length, "category", "categories")} · share of ${formatMoney(totalValue, currency)}`}
              actions={<ExportCsvButton onExport={exportCategories} />}
            />
            <Table
              rows={byCategory}
              columns={categoryColumns}
              rowKey={(r) => r.category}
              defaultSort={{ key: "value", dir: "desc" }}
              pageSize={100}
              dense
              footer={
                <span>
                  {pluralize(stocked.length, "item")} · {formatNumber(totalUnits, 2)} units · <span className="font-semibold text-text tabular">{formatMoney(totalValue, currency)}</span>
                </span>
              }
            />
          </section>

          <section className="flex flex-col gap-2">
            <ReportSubheader title={`Top ${Math.min(TOP_N, valued.length)} items by value`} description={`These hold ${formatPercent(topShare, 1)} of total inventory value.`} />
            <Table rows={top} columns={topColumns} rowKey={(r) => r.item.id} pageSize={TOP_N} dense />
          </section>
        </>
      )}
    </div>
  );
}
