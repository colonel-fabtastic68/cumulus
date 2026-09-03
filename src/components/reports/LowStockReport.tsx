"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import type { Supplier } from "@/lib/types";
import { lowStockReport, type LowStockRow } from "@/lib/inventory";
import { useCollection, useItems, useSettings } from "@/lib/store/provider";
import { formatMoney, formatNumber, formatQty, pluralize } from "@/lib/format";
import { cn, round, sum } from "@/lib/utils";
import { Badge, Table, type Column } from "@/components/ui";
import { csvFilename, downloadCsv } from "./csv";
import { AskAgentButton, Dash, ExportCsvButton, ReportEmpty, ReportHeader, SkuLink } from "./shared";

const AGENT_PROMPT = "Draft purchase orders for everything below minimum, grouped by supplier";

interface SupplierGroup {
  key: string;
  supplier?: Supplier;
  label: string;
  leadTimeDays?: number;
  rows: LowStockRow[];
  reorderUnits: number;
  estCost: number;
}

function estCost(r: LowStockRow): number {
  return round(r.reorder * r.item.unitCost);
}

function leadTime(r: LowStockRow): number | undefined {
  return r.item.leadTimeDays ?? r.supplier?.leadTimeDays;
}

export function LowStockReport() {
  const items = useItems();
  const suppliers = useCollection("suppliers");
  const movements = useCollection("movements");
  const { currency } = useSettings();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const rows = useMemo(() => lowStockReport(items, suppliers, movements), [items, suppliers, movements]);

  const groups = useMemo<SupplierGroup[]>(() => {
    const map = new Map<string, SupplierGroup>();
    for (const r of rows) {
      const key = r.supplier?.id ?? "none";
      let g = map.get(key);
      if (!g) {
        g = { key, supplier: r.supplier, label: r.supplier?.name ?? "No supplier", leadTimeDays: r.supplier?.leadTimeDays, rows: [], reorderUnits: 0, estCost: 0 };
        map.set(key, g);
      }
      g.rows.push(r);
      g.reorderUnits = round(g.reorderUnits + r.reorder, 2);
      g.estCost = round(g.estCost + estCost(r));
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.key === "none") return 1;
      if (b.key === "none") return -1;
      return b.estCost - a.estCost;
    });
  }, [rows]);

  const totals = useMemo(
    () => ({
      items: rows.length,
      suppliers: groups.filter((g) => g.key !== "none").length,
      unassigned: groups.find((g) => g.key === "none")?.rows.length ?? 0,
      units: round(sum(rows.map((r) => r.reorder)), 2),
      cost: round(sum(rows.map(estCost))),
    }),
    [rows, groups],
  );

  const columns = useMemo<Column<LowStockRow>[]>(
    () => [
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
      {
        key: "onHand",
        header: "On hand",
        align: "right",
        render: (r) => <span className={cn(r.item.onHand <= 0 && "font-medium text-critical")}>{formatQty(r.item.onHand, r.item.unit)}</span>,
        sortValue: (r) => r.item.onHand,
      },
      { key: "min", header: "Min", align: "right", render: (r) => (r.item.minQty === undefined ? <Dash /> : formatQty(r.item.minQty, r.item.unit)), sortValue: (r) => r.item.minQty ?? null },
      { key: "max", header: "Max", align: "right", hideBelow: "md", render: (r) => (r.item.maxQty === undefined ? <Dash /> : formatQty(r.item.maxQty, r.item.unit)), sortValue: (r) => r.item.maxQty ?? null },
      { key: "reorder", header: "Reorder qty", align: "right", render: (r) => <span className="font-medium text-text">{formatQty(r.reorder, r.item.unit)}</span>, sortValue: (r) => r.reorder },
      {
        key: "cover",
        header: "Days of cover",
        align: "right",
        render: (r) => {
          if (r.daysOfCover === null) return <Dash />;
          const lt = leadTime(r);
          const short = lt !== undefined && r.daysOfCover < lt;
          return short ? (
            <Badge tone="critical">{r.daysOfCover}d</Badge>
          ) : (
            <span>{r.daysOfCover}d</span>
          );
        },
        sortValue: (r) => r.daysOfCover,
      },
      { key: "lead", header: "Lead time", align: "right", hideBelow: "sm", render: (r) => (leadTime(r) === undefined ? <Dash /> : `${leadTime(r)}d`), sortValue: (r) => leadTime(r) ?? null },
      { key: "cost", header: "Est. cost", align: "right", render: (r) => formatMoney(estCost(r), currency), sortValue: estCost },
    ],
    [currency],
  );

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const exportCsv = () =>
    downloadCsv(
      csvFilename("low-stock-reorder"),
      ["Supplier", "Supplier lead time (days)", "SKU", "Name", "On hand", "Min", "Max", "Reorder qty", "Days of cover", "Item lead time (days)", "Unit cost", "Estimated cost"],
      groups.flatMap((g) => g.rows.map((r) => [g.label, g.leadTimeDays, r.item.sku, r.item.name, r.item.onHand, r.item.minQty, r.item.maxQty, r.reorder, r.daysOfCover, leadTime(r), r.item.unitCost, estCost(r)])),
    );

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title="Low stock & reorder"
        description="Active items below their minimum, grouped by supplier. Reorder quantity brings each item back to its maximum (or twice the minimum when no maximum is set). Days of cover uses the last 90 days of sales and builds; it is flagged when it is shorter than the lead time."
        actions={
          <>
            <ExportCsvButton onExport={exportCsv} disabled={rows.length === 0} />
            <AskAgentButton prompt={AGENT_PROMPT} label="Draft purchase orders" disabled={rows.length === 0} />
          </>
        }
      />

      {rows.length === 0 ? (
        <ReportEmpty icon={<CheckCircle2 />} title="Nothing below minimum" description="Every active item with a minimum quantity is at or above it. Set minimum and maximum quantities on items to have them show up here." />
      ) : (
        <>
          {groups.map((g) => {
            const open = !collapsed.has(g.key);
            return (
              <section key={g.key} className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => toggle(g.key)}
                  aria-expanded={open}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-[var(--radius)] px-2 py-1.5 text-left transition-colors hover:bg-surface-hover"
                >
                  {open ? <ChevronDown className="h-4 w-4 shrink-0 text-text-tertiary" /> : <ChevronRight className="h-4 w-4 shrink-0 text-text-tertiary" />}
                  <span className="text-[13.5px] font-semibold text-text">{g.label}</span>
                  <span className="text-[12.5px] text-text-secondary">{pluralize(g.rows.length, "item")}</span>
                  {g.leadTimeDays !== undefined ? <Badge>Lead time {pluralize(g.leadTimeDays, "day")}</Badge> : g.key === "none" ? <Badge tone="warning">Assign a supplier to plan lead time</Badge> : null}
                  <span className="ml-auto flex flex-wrap items-center gap-x-4 text-[12.5px] text-text-secondary">
                    <span>
                      Reorder <span className="tabular font-medium text-text">{formatNumber(g.reorderUnits, 2)}</span> units
                    </span>
                    <span>
                      Est. cost <span className="tabular font-medium text-text">{formatMoney(g.estCost, currency)}</span>
                    </span>
                  </span>
                </button>
                {open && <Table rows={g.rows} columns={columns} rowKey={(r) => r.item.id} defaultSort={{ key: "cover", dir: "asc" }} pageSize={200} dense />}
              </section>
            );
          })}

          <div className="card flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 text-[13px]">
            <span className="text-text-secondary">
              {pluralize(totals.items, "item")} below minimum across {pluralize(totals.suppliers, "supplier")}
              {totals.unassigned > 0 ? ` (${pluralize(totals.unassigned, "item")} with no supplier)` : ""}
            </span>
            <span className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <span className="text-text-secondary">
                Reorder units <span className="tabular font-semibold text-text">{formatNumber(totals.units, 2)}</span>
              </span>
              <span className="text-text-secondary">
                Estimated cost <span className="tabular font-semibold text-text">{formatMoney(totals.cost, currency)}</span>
              </span>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
