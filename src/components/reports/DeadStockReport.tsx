"use client";

import { useMemo, useState } from "react";
import { Archive, Sparkles, Sprout } from "lucide-react";
import { deadStockReport, deactivateItems } from "@/lib/inventory";
import { useCollection, useItems, useSettings, useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { formatDate, formatMoney, formatQty, formatRelative, pluralize } from "@/lib/format";
import { matches, round, sum } from "@/lib/utils";
import { Badge, Button, ConfirmDialog, SearchField, Segmented, Table, TextField, useToast, type Column } from "@/components/ui";
import { csvFilename, downloadCsv } from "./csv";
import { AskAgentButton, Dash, ExportCsvButton, ReportEmpty, ReportHeader, SkuLink } from "./shared";

type DeadRow = ReturnType<typeof deadStockReport>[number];
type View = "all" | "free" | "bom";

const MAX_SKUS_IN_PROMPT = 40;

function parseDays(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function DeadStockReport() {
  const items = useItems();
  const movements = useCollection("movements");
  const settings = useSettings();
  const store = useStore();
  const user = useCurrentUser();
  const writable = canWrite(user);
  const toast = useToast();
  const { open: openAgent } = useAgent();
  const currency = settings.currency;

  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("all");
  /** null = follow the workspace setting; a string once the user edits the box. */
  const [daysInput, setDaysInput] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const days = daysInput === null ? settings.inactivityDays : parseDays(daysInput, settings.inactivityDays);

  const all = useMemo(() => deadStockReport(items, movements, days), [items, movements, days]);
  const searched = useMemo(() => all.filter((r) => matches(q, r.item.sku, r.item.name, r.item.category)), [all, q]);
  const counts = useMemo(() => ({ all: searched.length, free: searched.filter((r) => r.usedIn === 0).length, bom: searched.filter((r) => r.usedIn > 0).length }), [searched]);
  const rows = useMemo(() => searched.filter((r) => (view === "all" ? true : view === "free" ? r.usedIn === 0 : r.usedIn > 0)), [searched, view]);

  const totals = useMemo(() => ({ units: round(sum(rows.map((r) => r.item.onHand)), 2), value: round(sum(rows.map((r) => r.item.onHand * r.item.unitCost))) }), [rows]);

  // Selection pruned to the rows currently visible.
  const visibleIds = useMemo(() => new Set(rows.map((r) => r.item.id)), [rows]);
  const selectedIds = useMemo(() => new Set(Array.from(selected).filter((id) => visibleIds.has(id))), [selected, visibleIds]);
  const selectedRows = useMemo(() => rows.filter((r) => selectedIds.has(r.item.id)), [rows, selectedIds]);
  const selectedInBom = useMemo(() => selectedRows.filter((r) => r.usedIn > 0).length, [selectedRows]);

  const columns = useMemo<Column<DeadRow>[]>(
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
      { key: "category", header: "Category", hideBelow: "lg", render: (r) => r.item.category ?? <Dash />, sortValue: (r) => r.item.category ?? "" },
      { key: "onHand", header: "On hand", align: "right", render: (r) => formatQty(r.item.onHand, r.item.unit), sortValue: (r) => r.item.onHand },
      { key: "value", header: "Value", align: "right", render: (r) => <span className="font-medium text-text">{formatMoney(round(r.item.onHand * r.item.unitCost), currency)}</span>, sortValue: (r) => r.item.onHand * r.item.unitCost },
      {
        key: "last",
        header: "Last movement",
        align: "right",
        render: (r) =>
          r.lastMovementAt ? (
            <span title={formatRelative(r.lastMovementAt)}>{formatDate(r.lastMovementAt)}</span>
          ) : (
            <span className="text-text-tertiary">Never</span>
          ),
        sortValue: (r) => r.lastMovementAt ?? "",
      },
      {
        key: "bom",
        header: "Used in active BOMs",
        align: "right",
        render: (r) => (r.usedIn > 0 ? <Badge tone="warning">In {pluralize(r.usedIn, "BOM")}</Badge> : <Dash />),
        sortValue: (r) => r.usedIn,
      },
    ],
    [currency],
  );

  const exportCsv = () =>
    downloadCsv(
      csvFilename("dead-stock"),
      ["SKU", "Name", "Category", "Type", "On hand", "Unit", "Unit cost", "Value", "Last movement", "Active BOMs using it"],
      rows.map((r) => [r.item.sku, r.item.name, r.item.category, r.item.type, r.item.onHand, r.item.unit, r.item.unitCost, round(r.item.onHand * r.item.unitCost), r.lastMovementAt ? formatDate(r.lastMovementAt) : "Never", r.usedIn]),
    );

  const reviewPrompt = `Review active items with no consumption in the last ${days} days. Recommend which to deactivate, which to sell off at a discount, and which to keep because they are used in active BOMs. Include the value tied up in each group.`;

  const askAboutSelection = () => {
    const skus = selectedRows.slice(0, MAX_SKUS_IN_PROMPT).map((r) => r.item.sku);
    const more = selectedRows.length > MAX_SKUS_IN_PROMPT ? ` (and ${selectedRows.length - MAX_SKUS_IN_PROMPT} more)` : "";
    openAgent(`Review these SKUs from the dead stock report (no consumption in ${days} days): ${skus.join(", ")}${more}. For each, recommend deactivate, sell off, or keep, and call out any that are used in active BOMs.`, { send: true });
  };

  const deactivate = async () => {
    const ids = selectedRows.map((r) => r.item.id);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const n = await deactivateItems(store, user, ids, { reason: `No movement in ${days} days (dead stock report)` });
      toast(`Deactivated ${pluralize(n, "item")}`, "success");
      setSelected(new Set());
      setConfirmOpen(false);
    } catch (e) {
      toast(errorMessage(e), "critical");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        title="Dead stock"
        description={`Active items with no sales, builds or write-offs in the last ${pluralize(days, "day")}. Items still used in an active BOM are listed for completeness but probably should not be deactivated; use the filter to hide them.`}
        actions={
          <>
            <ExportCsvButton onExport={exportCsv} disabled={rows.length === 0} />
            <AskAgentButton prompt={reviewPrompt} label="Review with Nimbus" disabled={all.length === 0} />
          </>
        }
      />

      {all.length === 0 && !q ? (
        <ReportEmpty icon={<Sprout />} title="Everything is moving" description={`Every active item has been sold, built or written off in the last ${pluralize(days, "day")}. Widen the window to look further back.`} />
      ) : (
        <Table
          rows={rows}
          columns={columns}
          rowKey={(r) => r.item.id}
          selectable
          selected={selectedIds}
          onSelectedChange={setSelected}
          defaultSort={{ key: "last", dir: "asc" }}
          pageSize={100}
          toolbar={
            <>
              <SearchField value={q} onChange={setQ} placeholder="Search SKU or name" className="w-full sm:w-64" />
              <TextField
                type="number"
                min={1}
                step={1}
                value={daysInput ?? String(settings.inactivityDays)}
                onChange={(e) => setDaysInput(e.target.value)}
                prefix="No movement in"
                suffix="days"
                containerClassName="w-56"
                className="pl-[108px]"
                aria-label="Inactivity window (days)"
              />
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: "all", label: "All", count: counts.all },
                  { value: "free", label: "Not in a BOM", count: counts.free },
                  { value: "bom", label: "In active BOM", count: counts.bom },
                ]}
              />
            </>
          }
          bulkActions={() => (
            <>
              {writable && (
                <Button size="sm" icon={<Archive />} onClick={() => setConfirmOpen(true)}>
                  Deactivate selected
                </Button>
              )}
              <Button size="sm" icon={<Sparkles />} onClick={askAboutSelection}>
                Ask Nimbus to review
              </Button>
            </>
          )}
          emptyState={<span>No items match this filter.</span>}
          footer={
            <span>
              {pluralize(rows.length, "item")} · {formatQty(totals.units)} units · <span className="font-semibold text-text tabular">{formatMoney(totals.value, currency)}</span> tied up
            </span>
          }
        />
      )}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={deactivate}
        loading={busy}
        destructive
        confirmLabel="Deactivate"
        title={`Deactivate ${pluralize(selectedRows.length, "item")}?`}
        message={
          <>
            <p>They will be marked inactive and hidden from pickers and reorder lists. Stock on hand and the movement history are kept, and you can reactivate them from the item page.</p>
            {selectedInBom > 0 && (
              <p className="mt-2 font-medium text-warning">
                {pluralize(selectedInBom, "of these is", "of these are")} used in an active BOM. Builds that need them will fail until the BOM is updated.
              </p>
            )}
          </>
        }
      />
    </div>
  );
}
