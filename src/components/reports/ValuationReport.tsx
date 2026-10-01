"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PackageOpen } from "lucide-react";
import type { Lot } from "@/lib/types";
import { costingMethod } from "@/lib/inventory";
import { cogsBetween, COSTING_LABELS, inventoryValueAt, receiptsBetween, totalValue, valueItems, type ValuedItem } from "@/lib/valuation";
import { lotLabel } from "@/lib/traceability";
import { useCollection, useItems, useSettings } from "@/lib/store/provider";
import { formatDate, formatMoney, formatNumber, formatPercent, formatQty, fromDateInput, pluralize, toDateInput } from "@/lib/format";
import { daysAgoIso, round, sum } from "@/lib/utils";
import { Stat, Table, TextField, type Column } from "@/components/ui";
import { csvFilename, downloadCsv } from "./csv";
import { AskAgentButton, ExportCsvButton, ReportEmpty, ReportHeader, ReportSubheader, ShareBar, SkuLink } from "./shared";

const TOP_N = 15;
const UNCATEGORIZED = "Uncategorized";
const AGENT_PROMPT =
  "Summarize where inventory value is concentrated by category and by SKU, note how the costing method affects it, then suggest three concrete ways to reduce working capital without risking stock-outs on finished goods.";

interface ValuedRow extends ValuedItem {
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

interface LayerRow {
  lot: Lot;
  item: ValuedItem["item"];
  value: number;
}

export function ValuationReport() {
  const items = useItems();
  const lots = useCollection("lots");
  const movements = useCollection("movements");
  const settings = useSettings();
  const { currency } = settings;
  const method = costingMethod(settings);
  const [asOf, setAsOf] = useState(() => toDateInput(daysAgoIso(30)));

  const valued = useMemo<ValuedRow[]>(() => {
    const rows = valueItems(items, lots, method);
    const total = totalValue(rows);
    return rows.map((r) => ({ ...r, share: total > 0 ? (r.value / total) * 100 : 0 }));
  }, [items, lots, method]);
  const total = useMemo(() => totalValue(valued), [valued]);
  const totalUnits = useMemo(() => round(sum(valued.map((r) => r.onHand)), 2), [valued]);
  const top = useMemo(() => valued.slice(0, TOP_N), [valued]);
  const topShare = useMemo(() => sum(top.map((t) => t.share)), [top]);
  const last30 = useMemo(() => {
    const from = daysAgoIso(30);
    const to = new Date().toISOString();
    return { cogs: cogsBetween(movements, from, to), received: receiptsBetween(movements, from, to) };
  }, [movements]);
  const atDate = useMemo(() => {
    const iso = new Date(fromDateInput(asOf)).toISOString().slice(0, 10) + "T23:59:59.999Z";
    const rows = inventoryValueAt(items, movements, iso);
    return { rows, total: round(sum(rows.map((r) => r.value))), units: round(sum(rows.map((r) => Math.max(0, r.qty))), 2) };
  }, [items, movements, asOf]);

  const byCategory = useMemo<CategoryRow[]>(() => {
    const map = new Map<string, CategoryRow>();
    for (const v of valued) {
      const key = v.item.category?.trim() || UNCATEGORIZED;
      let row = map.get(key);
      if (!row) {
        row = { category: key, items: 0, units: 0, value: 0, share: 0 };
        map.set(key, row);
      }
      row.items += 1;
      row.units = round(row.units + v.onHand, 2);
      row.value = round(row.value + v.value);
    }
    for (const r of map.values()) r.share = total > 0 ? (r.value / total) * 100 : 0;
    return Array.from(map.values()).sort((a, b) => b.value - a.value || a.category.localeCompare(b.category));
  }, [valued, total]);

  const layers = useMemo<LayerRow[]>(() => valued.flatMap((v) => v.layers.map((lot) => ({ lot, item: v.item, value: round(lot.qtyRemaining * lot.unitCost) }))).sort((a, b) => a.lot.receivedAt.localeCompare(b.lot.receivedAt)), [valued]);

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

  const topColumns = useMemo<Column<ValuedRow>[]>(
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
      { key: "category", header: "Category", hideBelow: "md", render: (r) => r.item.category ?? <span className="text-text-tertiary">{UNCATEGORIZED}</span>, sortValue: (r) => r.item.category ?? "" },
      { key: "onHand", header: "On hand", align: "right", render: (r) => formatQty(r.onHand, r.item.unit), sortValue: (r) => r.onHand },
      {
        key: "unitValue",
        header: method === "fifo" ? "Unit value" : "Unit cost",
        align: "right",
        hideBelow: "sm",
        render: (r) => (
          <span>
            {formatMoney(r.unitValue, currency)}
            {method === "fifo" && r.layers.length > 1 && <span className="block text-[11px] text-text-tertiary">{pluralize(r.layers.length, "layer")}</span>}
          </span>
        ),
        sortValue: (r) => r.unitValue,
      },
      { key: "value", header: "Value", align: "right", render: (r) => <span className="font-medium text-text">{formatMoney(r.value, currency)}</span>, sortValue: (r) => r.value },
      { key: "share", header: "Share", align: "right", width: "160px", render: (r) => <ShareBar pct={r.share} />, sortValue: (r) => r.share },
    ],
    [currency, top, method],
  );

  const layerColumns = useMemo<Column<LayerRow>[]>(
    () => [
      { key: "received", header: "Received", render: (r) => formatDate(r.lot.receivedAt), sortValue: (r) => r.lot.receivedAt },
      {
        key: "lot",
        header: "Batch",
        render: (r) => (
          <Link href={`/reports?tab=traceability&lot=${encodeURIComponent(r.lot.id)}`} className="font-mono text-[12px] text-accent hover:underline">
            {lotLabel(r.lot)}
          </Link>
        ),
        sortValue: (r) => lotLabel(r.lot),
      },
      { key: "sku", header: "SKU", render: (r) => <SkuLink item={r.item} />, sortValue: (r) => r.item.sku },
      { key: "name", header: "Item", hideBelow: "md", render: (r) => <span className="block max-w-[240px] truncate">{r.item.name}</span>, sortValue: (r) => r.item.name },
      { key: "qty", header: "Remaining", align: "right", render: (r) => formatQty(r.lot.qtyRemaining, r.item.unit), sortValue: (r) => r.lot.qtyRemaining },
      { key: "cost", header: "Layer cost", align: "right", render: (r) => formatMoney(r.lot.unitCost, currency), sortValue: (r) => r.lot.unitCost },
      { key: "value", header: "Value", align: "right", render: (r) => <span className="font-medium text-text">{formatMoney(r.value, currency)}</span>, sortValue: (r) => r.value },
    ],
    [currency],
  );

  const exportItems = () =>
    downloadCsv(
      csvFilename("valuation-items"),
      ["SKU", "Name", "Category", "Type", "Status", "On hand", "Unit", "Unit value", "Value", "Share %", "Method"],
      valued.map((v) => [v.item.sku, v.item.name, v.item.category, v.item.type, v.item.status, v.onHand, v.item.unit, v.unitValue, v.value, round(v.share, 2), COSTING_LABELS[method]]),
    );
  const exportCategories = () =>
    downloadCsv(
      csvFilename("valuation-by-category"),
      ["Category", "Items", "Units", "Value", "Share %"],
      byCategory.map((r) => [r.category, r.items, r.units, r.value, round(r.share, 2)]),
    );
  const exportLayers = () => downloadCsv(csvFilename("valuation-layers"), ["Received", "Batch", "SKU", "Name", "Remaining", "Layer cost", "Value"], layers.map((r) => [formatDate(r.lot.receivedAt), lotLabel(r.lot), r.item.sku, r.item.name, r.lot.qtyRemaining, r.lot.unitCost, r.value]));
  const exportAtDate = () => {
    const byId = new Map(items.map((i) => [i.id, i]));
    downloadCsv(
      csvFilename(`valuation-as-of-${asOf}`),
      ["SKU", "Name", "Qty on hand", "Value"],
      atDate.rows.filter((r) => r.qty > 0 || r.value > 0).sort((a, b) => b.value - a.value).map((r) => [byId.get(r.itemId)?.sku ?? r.itemId, byId.get(r.itemId)?.name ?? "", r.qty, r.value]),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title="Inventory valuation"
        description={`What is on the shelf right now under ${method === "fifo" ? "FIFO" : COSTING_LABELS[method].toLowerCase()} costing (Settings → Inventory policy). ${method === "fifo" ? "Each batch is a layer at the price it came in at; consumption took the oldest first." : method === "average" ? "Each item's cost is the weighted average of its deliveries." : "Each item is valued at its standard cost; assemblies at their rolled-up cost."} The value at a past date and the cost of goods sold come from the ledger, which carries a cost on every movement.`}
        actions={
          <>
            <ExportCsvButton onExport={exportItems} disabled={valued.length === 0} />
            <AskAgentButton prompt={AGENT_PROMPT} label="Ask Strato" disabled={valued.length === 0} />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 @md:grid-cols-4">
        <Stat label="Total value" value={formatMoney(total, currency)} hint={`${COSTING_LABELS[method]} · ${formatNumber(totalUnits, 2)} units · ${pluralize(valued.length, "SKU")} with stock`} />
        <Stat label="Cost of goods sold" value={formatMoney(last30.cogs.cogs, currency)} hint={`Last 30 days · ${formatNumber(last30.cogs.units, 2)} units shipped`} />
        <Stat label="Received" value={formatMoney(last30.received.value, currency)} hint={`Last 30 days · ${formatNumber(last30.received.units, 2)} units in`} />
        <div className="card flex flex-col gap-1 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-text-secondary">Value on a date</span>
            <ExportCsvButton onExport={exportAtDate} label="CSV" disabled={atDate.rows.length === 0} />
          </div>
          <div className="flex items-end gap-3">
            <span className="text-[22px] font-semibold tabular text-text">{formatMoney(atDate.total, currency)}</span>
          </div>
          <TextField type="date" value={asOf} max={toDateInput()} onChange={(e) => setAsOf(e.target.value)} aria-label="Valuation date" containerClassName="mt-1" help={`${formatNumber(atDate.units, 2)} units at the end of that day, from the ledger`} />
        </div>
      </div>

      {valued.length === 0 ? (
        <ReportEmpty icon={<PackageOpen />} title="Nothing on the shelf" description="Receive stock or set opening balances and the valuation will fill in here." />
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <ReportSubheader
              title="By category"
              description={`${pluralize(byCategory.length, "category", "categories")} · share of ${formatMoney(total, currency)}`}
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
                  {pluralize(valued.length, "item")} · {formatNumber(totalUnits, 2)} units · <span className="font-semibold text-text tabular">{formatMoney(total, currency)}</span>
                </span>
              }
            />
          </section>

          <section className="flex flex-col gap-2">
            <ReportSubheader title={`Top ${Math.min(TOP_N, valued.length)} items by value`} description={`These hold ${formatPercent(topShare, 1)} of total inventory value.`} />
            <Table rows={top} columns={topColumns} rowKey={(r) => r.item.id} pageSize={TOP_N} dense />
          </section>

          {method === "fifo" && layers.length > 0 && (
            <section className="flex flex-col gap-2">
              <ReportSubheader title="Layers on the shelf" description={`${pluralize(layers.length, "batch", "batches")} still holding stock, oldest first: the next sale or build takes from the top.`} actions={<ExportCsvButton onExport={exportLayers} />} />
              <Table rows={layers} columns={layerColumns} rowKey={(r) => r.lot.id} defaultSort={{ key: "received", dir: "asc" }} pageSize={50} dense footer={<span>{pluralize(layers.length, "layer")} · <span className="font-semibold text-text tabular">{formatMoney(round(sum(layers.map((l) => l.value))), currency)}</span></span>} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
