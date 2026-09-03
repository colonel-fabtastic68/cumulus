"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, CornerDownRight, Timer } from "lucide-react";
import type { Lot } from "@/lib/types";
import { shelfLifeReport, type ShelfLifeRow } from "@/lib/inventory";
import { useCollection, useItems, useSettings } from "@/lib/store/provider";
import { formatDate, formatMoney, formatQty, pluralize } from "@/lib/format";
import { cn, daysBetween, matches, round, sum } from "@/lib/utils";
import { Badge, SearchField, Table, TextField, type Column } from "@/components/ui";
import { csvFilename, downloadCsv } from "./csv";
import { AskAgentButton, Dash, ExportCsvButton, ReportEmpty, ReportHeader, SkuLink } from "./shared";

const DEFAULT_OLDER_THAN = 90;
const WARN_DAYS = 180;

/**
 * The table is a flat list: each item row is followed by its lot rows while
 * expanded. Lot rows carry the parent's sort values so sorting keeps a group
 * together (Array.prototype.sort is stable), and the parent always sorts first.
 */
type FlatRow = { kind: "item"; key: string; parent: ShelfLifeRow; expanded: boolean } | { kind: "lot"; key: string; parent: ShelfLifeRow; lot: Lot; age: number };

function parseDays(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function ShelfLifeReport() {
  const items = useItems();
  const lots = useCollection("lots");
  const receipts = useCollection("receipts");
  const { currency } = useSettings();

  const [q, setQ] = useState("");
  const [olderThanInput, setOlderThanInput] = useState(String(DEFAULT_OLDER_THAN));
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const olderThan = parseDays(olderThanInput, DEFAULT_OLDER_THAN);

  const receiptNumber = useMemo(() => new Map(receipts.map((r) => [r.id, r.number])), [receipts]);
  const all = useMemo(() => shelfLifeReport(items, lots), [items, lots]);
  const rows = useMemo(() => all.filter((r) => r.oldestDays >= olderThan && matches(q, r.item.sku, r.item.name, r.item.category)), [all, olderThan, q]);

  const flat = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    for (const parent of rows) {
      const isOpen = expanded.has(parent.item.id);
      out.push({ kind: "item", key: parent.item.id, parent, expanded: isOpen });
      if (isOpen) for (const lot of parent.lots) out.push({ kind: "lot", key: `${parent.item.id}:${lot.id}`, parent, lot, age: daysBetween(lot.receivedAt) });
    }
    return out;
  }, [rows, expanded]);

  const totals = useMemo(
    () => ({
      batches: sum(rows.map((r) => r.remainingLots)),
      value: round(sum(rows.flatMap((r) => r.lots.map((l) => l.qtyRemaining * l.unitCost)))),
      over: rows.filter((r) => r.oldestDays > WARN_DAYS).length,
    }),
    [rows],
  );

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const columns = useMemo<Column<FlatRow>[]>(
    () => [
      {
        key: "expand",
        header: "",
        width: "32px",
        className: "pr-0",
        render: (r) =>
          r.kind === "item" ? (
            <span className="text-text-tertiary">{r.expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
          ) : (
            <span className="text-text-tertiary">
              <CornerDownRight className="ml-1 h-3.5 w-3.5" />
            </span>
          ),
      },
      {
        key: "sku",
        header: "SKU",
        width: "150px",
        render: (r) => (r.kind === "item" ? <SkuLink item={r.parent.item} /> : <span className="text-[12px] text-text-tertiary">Batch{r.lot.receiptId && receiptNumber.get(r.lot.receiptId) ? ` · ${receiptNumber.get(r.lot.receiptId)}` : ""}</span>),
        sortValue: (r) => r.parent.item.sku,
      },
      {
        key: "name",
        header: "Item",
        render: (r) =>
          r.kind === "item" ? (
            <span className="block max-w-[280px] truncate" title={r.parent.item.name}>
              {r.parent.item.name}
            </span>
          ) : (
            <span className="text-text-secondary">Received {formatDate(r.lot.receivedAt)}</span>
          ),
        sortValue: (r) => r.parent.item.name,
      },
      {
        key: "onHand",
        header: "On hand",
        align: "right",
        render: (r) =>
          r.kind === "item" ? (
            formatQty(r.parent.item.onHand, r.parent.item.unit)
          ) : (
            <span className="text-text-secondary">
              {formatQty(r.lot.qtyRemaining, r.parent.item.unit)} <span className="text-text-tertiary">of {formatQty(r.lot.qtyReceived, r.parent.item.unit)}</span>
            </span>
          ),
        sortValue: (r) => r.parent.item.onHand,
      },
      {
        key: "oldest",
        header: "Oldest batch",
        align: "right",
        render: (r) => {
          if (r.kind === "lot") return <span className={cn("text-text-secondary", r.age > WARN_DAYS && "text-warning")}>{pluralize(r.age, "day")}</span>;
          return (
            <span className="inline-flex items-center gap-2">
              {r.parent.oldestDays > WARN_DAYS && <Badge tone="warning">Over {WARN_DAYS} days</Badge>}
              <span className={cn(r.parent.oldestDays > WARN_DAYS && "font-medium text-warning")}>{pluralize(r.parent.oldestDays, "day")}</span>
            </span>
          );
        },
        sortValue: (r) => r.parent.oldestDays,
      },
      {
        key: "avg",
        header: "Avg age",
        align: "right",
        hideBelow: "sm",
        render: (r) => (r.kind === "item" ? pluralize(r.parent.avgAgeDays, "day") : <Dash />),
        sortValue: (r) => r.parent.avgAgeDays,
      },
      {
        key: "batches",
        header: "Batches",
        align: "right",
        hideBelow: "md",
        render: (r) => (r.kind === "item" ? formatQty(r.parent.remainingLots) : <Dash />),
        sortValue: (r) => r.parent.remainingLots,
      },
      {
        key: "unitCost",
        header: "Unit cost",
        align: "right",
        hideBelow: "md",
        render: (r) => (r.kind === "item" ? formatMoney(r.parent.item.unitCost, currency) : <span className="text-text-secondary">{formatMoney(r.lot.unitCost, currency)}</span>),
        sortValue: (r) => r.parent.item.unitCost,
      },
      {
        key: "value",
        header: "Value",
        align: "right",
        render: (r) =>
          r.kind === "item" ? (
            <span className="font-medium text-text">{formatMoney(round(sum(r.parent.lots.map((l) => l.qtyRemaining * l.unitCost))), currency)}</span>
          ) : (
            <span className="text-text-secondary">{formatMoney(round(r.lot.qtyRemaining * r.lot.unitCost), currency)}</span>
          ),
        sortValue: (r) => sum(r.parent.lots.map((l) => l.qtyRemaining * l.unitCost)),
      },
    ],
    [currency, receiptNumber],
  );

  const exportCsv = () =>
    downloadCsv(
      csvFilename("shelf-life"),
      ["SKU", "Name", "Category", "On hand", "Oldest batch (days)", "Weighted avg age (days)", "Batches", "Batch received", "Batch age (days)", "Qty remaining", "Qty received", "Batch unit cost", "Batch value"],
      rows.flatMap((r) =>
        r.lots.map((l) => [
          r.item.sku,
          r.item.name,
          r.item.category,
          r.item.onHand,
          r.oldestDays,
          r.avgAgeDays,
          r.remainingLots,
          formatDate(l.receivedAt),
          daysBetween(l.receivedAt),
          l.qtyRemaining,
          l.qtyReceived,
          l.unitCost,
          round(l.qtyRemaining * l.unitCost),
        ]),
      ),
    );

  const agentPrompt = `Suggest sale prices for stock that has been on the shelf for more than ${olderThan} days. Keep at least 30% margin over unit cost, prioritise the oldest and highest-value batches, and explain the reasoning per SKU.`;

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title="Shelf life"
        description="How long stock has been sitting, by batch. Age is counted from the date each batch was received; the weighted average is by remaining quantity. Click a row to see its batches."
        actions={
          <>
            <ExportCsvButton onExport={exportCsv} disabled={rows.length === 0} />
            <AskAgentButton prompt={agentPrompt} label="Suggest sale prices" disabled={rows.length === 0} />
          </>
        }
      />

      {all.length === 0 ? (
        <ReportEmpty icon={<Timer />} title="No batches tracked yet" description="Batches are created when stock is received or built. Once there is stock with a receipt date behind it, its age shows up here." />
      ) : (
        <Table
          rows={flat}
          columns={columns}
          rowKey={(r) => r.key}
          onRowClick={(r) => toggle(r.parent.item.id)}
          defaultSort={{ key: "oldest", dir: "desc" }}
          pageSize={500}
          dense
          toolbar={
            <>
              <SearchField value={q} onChange={setQ} placeholder="Search SKU or name" className="w-full sm:w-64" />
              <TextField type="number" min={0} step={1} value={olderThanInput} onChange={(e) => setOlderThanInput(e.target.value)} prefix="Older than" suffix="days" containerClassName="w-48" className="pl-[76px]" aria-label="Older than (days)" />
              {totals.over > 0 && <Badge tone="warning">{pluralize(totals.over, "item")} over {WARN_DAYS} days</Badge>}
            </>
          }
          emptyState={<span>Nothing has been on the shelf longer than {pluralize(olderThan, "day")}.</span>}
          footer={
            <span>
              {pluralize(rows.length, "item")} · {pluralize(totals.batches, "batch", "batches")} · <span className="font-semibold text-text tabular">{formatMoney(totals.value, currency)}</span> at batch cost
            </span>
          }
        />
      )}
    </div>
  );
}
