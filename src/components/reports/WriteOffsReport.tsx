"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import type { Item, Member, StockMovement } from "@/lib/types";
import { useCollection, useItemsById, useSettings } from "@/lib/store/provider";
import { formatDate, formatDateTime, formatMoney, formatNumber, formatQty, pluralize } from "@/lib/format";
import { matches, round, sum } from "@/lib/utils";
import { Badge, SearchField, Select, Stat, Table, type Column } from "@/components/ui";
import { csvFilename, downloadCsv } from "./csv";
import { AskAgentButton, Dash, ExportCsvButton, ReportEmpty, ReportHeader, ReportSubheader, ShareBar, SkuLink, WINDOW_OPTIONS } from "./shared";

interface Row {
  movement: StockMovement;
  item: Item;
  units: number;
  cost: number;
  reason: string;
  by?: Member;
}

interface ReasonRow {
  reason: string;
  events: number;
  units: number;
  cost: number;
  share: number;
}

const NO_REASON = "No reason given";

/** Negative write-off / count / adjustment movements inside the window, newest first. */
function collectWriteOffs(movements: StockMovement[], itemsById: Map<string, Item>, membersById: Map<string, Member>, days: number): Row[] {
  const since = Date.now() - days * 86_400_000;
  const out: Row[] = [];
  for (const m of movements) {
    if (m.qty >= 0) continue;
    if (m.type !== "write_off" && m.type !== "count" && m.type !== "adjustment") continue;
    if (new Date(m.occurredAt).getTime() < since) continue;
    const item = itemsById.get(m.itemId);
    if (!item) continue;
    const units = -m.qty;
    out.push({ movement: m, item, units, cost: round(units * (m.unitCost ?? item.unitCost)), reason: m.reason?.trim() || NO_REASON, by: membersById.get(m.createdBy) });
  }
  return out.sort((a, b) => b.movement.occurredAt.localeCompare(a.movement.occurredAt));
}

/** Write-offs plus negative counts and adjustments: everything that left stock without being sold or built. */
export function WriteOffsReport() {
  const movements = useCollection("movements");
  const members = useCollection("members");
  const itemsById = useItemsById();
  const { currency, companyName } = useSettings();

  const [q, setQ] = useState("");
  const [windowValue, setWindowValue] = useState("90");
  const [type, setType] = useState<"all" | "write_off" | "count" | "adjustment">("all");
  const days = Number(windowValue);

  const membersById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const all = useMemo<Row[]>(() => collectWriteOffs(movements, itemsById, membersById, days), [movements, itemsById, membersById, days]);

  const rows = useMemo(
    () => all.filter((r) => (type === "all" || r.movement.type === type) && matches(q, r.item.sku, r.item.name, r.reason, r.movement.note, r.by?.name)),
    [all, type, q],
  );

  const totals = useMemo(() => ({ units: round(sum(rows.map((r) => r.units)), 2), cost: round(sum(rows.map((r) => r.cost))) }), [rows]);

  const byReason = useMemo<ReasonRow[]>(() => {
    const map = new Map<string, ReasonRow>();
    for (const r of rows) {
      const row = map.get(r.reason) ?? { reason: r.reason, events: 0, units: 0, cost: 0, share: 0 };
      row.events += 1;
      row.units = round(row.units + r.units, 2);
      row.cost = round(row.cost + r.cost);
      map.set(r.reason, row);
    }
    const list = Array.from(map.values()).sort((a, b) => b.cost - a.cost);
    for (const row of list) row.share = totals.cost > 0 ? round((row.cost / totals.cost) * 100, 1) : 0;
    return list;
  }, [rows, totals.cost]);

  const topReason = byReason[0];

  const columns = useMemo<Column<Row>[]>(
    () => [
      {
        key: "date",
        header: "Date",
        width: "120px",
        render: (r) => <span title={formatDateTime(r.movement.occurredAt)}>{formatDate(r.movement.occurredAt)}</span>,
        sortValue: (r) => r.movement.occurredAt,
      },
      { key: "sku", header: "SKU", width: "150px", render: (r) => <SkuLink item={r.item} />, sortValue: (r) => r.item.sku },
      {
        key: "name",
        header: "Item",
        hideBelow: "md",
        render: (r) => (
          <span className="block max-w-[240px] truncate" title={r.item.name}>
            {r.item.name}
          </span>
        ),
        sortValue: (r) => r.item.name,
      },
      {
        key: "type",
        header: "Type",
        render: (r) => <Badge tone={r.movement.type === "write_off" ? "critical" : "default"}>{r.movement.type === "write_off" ? "Write-off" : r.movement.type === "count" ? "Count" : "Adjustment"}</Badge>,
        sortValue: (r) => r.movement.type,
      },
      { key: "units", header: "Units", align: "right", render: (r) => <span className="text-critical">−{formatQty(r.units, r.item.unit)}</span>, sortValue: (r) => r.units },
      { key: "cost", header: "Cost impact", align: "right", render: (r) => <span className="font-medium text-text">{formatMoney(r.cost, currency)}</span>, sortValue: (r) => r.cost },
      {
        key: "reason",
        header: "Reason",
        render: (r) => {
          const text = [r.reason === NO_REASON ? undefined : r.reason, r.movement.note].filter(Boolean).join(" · ");
          return text ? (
            <span className="block max-w-[260px] truncate text-text-secondary" title={text}>
              {text}
            </span>
          ) : (
            <Dash />
          );
        },
        sortValue: (r) => r.reason,
      },
      { key: "by", header: "By", hideBelow: "lg", render: (r) => <span className="text-text-secondary">{r.by?.name ?? (r.movement.createdBy === "agent" ? "Agent" : <Dash />)}</span>, sortValue: (r) => r.by?.name ?? "" },
    ],
    [currency],
  );

  const reasonColumns = useMemo<Column<ReasonRow>[]>(
    () => [
      { key: "reason", header: "Reason", render: (r) => r.reason, sortValue: (r) => r.reason },
      { key: "events", header: "Events", align: "right", render: (r) => formatNumber(r.events), sortValue: (r) => r.events },
      { key: "units", header: "Units", align: "right", render: (r) => formatNumber(r.units, 2), sortValue: (r) => r.units },
      { key: "cost", header: "Cost", align: "right", render: (r) => formatMoney(r.cost, currency), sortValue: (r) => r.cost },
      { key: "share", header: "Share of cost", align: "right", render: (r) => <ShareBar pct={r.share} />, sortValue: (r) => r.share },
    ],
    [currency],
  );

  const exportCsv = () =>
    downloadCsv(
      csvFilename(`write-offs-${days}d`),
      ["Date", "SKU", "Name", "Type", "Units", "Unit", "Unit cost", "Cost impact", "Reason", "Note", "By"],
      rows.map((r) => [r.movement.occurredAt.slice(0, 10), r.item.sku, r.item.name, r.movement.type, r.units, r.item.unit, r.movement.unitCost ?? r.item.unitCost, r.cost, r.reason === NO_REASON ? "" : r.reason, r.movement.note, r.by?.name]),
    );

  const agentPrompt = `Review the write-offs, negative counts and adjustments at ${companyName} over the last ${days} days. Which items and reasons cost us the most, is anything recurring that points to a process problem (receiving, handling, QC), and what should we change?`;

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title="Write-offs"
        description="Stock that left the shelf without being sold or built: write-offs (damaged, failed QC, samples, R&D) plus negative cycle counts and adjustments. Cost impact uses the unit cost recorded on each movement."
        actions={
          <>
            <ExportCsvButton onExport={exportCsv} disabled={rows.length === 0} />
            <AskAgentButton prompt={agentPrompt} label="Ask agent" disabled={all.length === 0} />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Units written off" value={formatNumber(totals.units, 2)} hint={`${pluralize(rows.length, "event")} in the last ${days} days`} tone={totals.units > 0 ? "critical" : "default"} />
        <Stat label="Cost impact" value={formatMoney(totals.cost, currency)} hint="At the unit cost on each movement" tone={totals.cost > 0 ? "critical" : "default"} />
        <Stat label="Top reason" value={topReason ? topReason.reason : "—"} hint={topReason ? `${formatMoney(topReason.cost, currency)} · ${formatNumber(topReason.share, 1)}% of cost` : "Nothing written off"} />
      </div>

      {all.length === 0 && !q ? (
        <ReportEmpty icon={<Trash2 />} title="Nothing written off in this window" description={`No write-offs, negative counts or adjustments in the last ${days} days. Try a wider window.`} />
      ) : (
        <>
          <Table
            rows={rows}
            columns={columns}
            rowKey={(r) => r.movement.id}
            defaultSort={{ key: "date", dir: "desc" }}
            pageSize={100}
            toolbar={
              <>
                <SearchField value={q} onChange={setQ} placeholder="Search SKU, reason or person" className="w-full sm:w-64" />
                <Select value={windowValue} onChange={(e) => setWindowValue(e.target.value)} options={WINDOW_OPTIONS} containerClassName="w-40" aria-label="Window" />
                <Select
                  value={type}
                  onChange={(e) => setType(e.target.value as typeof type)}
                  options={[
                    { value: "all", label: "All types" },
                    { value: "write_off", label: "Write-offs" },
                    { value: "count", label: "Negative counts" },
                    { value: "adjustment", label: "Negative adjustments" },
                  ]}
                  containerClassName="w-44"
                  aria-label="Movement type"
                />
              </>
            }
            emptyState={<span>No write-offs match this filter.</span>}
            footer={
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>{pluralize(rows.length, "event")}</span>
                <span>
                  Units <span className="font-semibold text-text tabular">{formatNumber(totals.units, 2)}</span>
                </span>
                <span>
                  Cost <span className="font-semibold text-text tabular">{formatMoney(totals.cost, currency)}</span>
                </span>
              </span>
            }
          />
          {byReason.length > 0 && (
            <div className="flex flex-col gap-2">
              <ReportSubheader title="By reason" description="Where the cost is going. Recurring reasons usually point at a process, not bad luck." />
              <Table rows={byReason} columns={reasonColumns} rowKey={(r) => r.reason} defaultSort={{ key: "cost", dir: "desc" }} dense pageSize={50} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
