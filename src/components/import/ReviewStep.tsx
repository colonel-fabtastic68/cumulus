"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Download, FileWarning } from "lucide-react";
import { Badge, Banner, Button, Card, EmptyState, SearchField, Segmented, Table, Toggle, useToast, type Column } from "@/components/ui";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { formatMoney, formatQty, pluralize } from "@/lib/format";
import { importItems, InventoryError, type ImportResult } from "@/lib/inventory";
import { useItemsBySku, useSettings, useStore } from "@/lib/store/provider";
import { matches } from "@/lib/utils";
import { buildReviewRows } from "./convert";
import type { ColumnMapping, ParsedSource, ReviewRow, ReviewStatus } from "./types";

type Filter = "all" | ReviewStatus;

const STATUS_TONE: Record<ReviewStatus, "success" | "info" | "critical"> = { new: "success", update: "info", error: "critical" };
const STATUS_LABEL: Record<ReviewStatus, string> = { new: "New", update: "Update", error: "Error" };

interface ReviewStepProps {
  source: ParsedSource;
  mapping: ColumnMapping;
  onBack: () => void;
  onDone: (result: ImportResult, attempted: number) => void;
}

export function ReviewStep({ source, mapping, onBack, onDone }: ReviewStepProps) {
  const store = useStore();
  const user = useCurrentUser();
  const settings = useSettings();
  const itemsBySku = useItemsBySku();
  const toast = useToast();
  const writable = canWrite(user);

  const [setQuantities, setSetQuantities] = useState(false);
  const [skipErrors, setSkipErrors] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);

  const reviewRows = useMemo(() => buildReviewRows(source.rows, mapping, itemsBySku), [source.rows, mapping, itemsBySku]);
  const counts = useMemo(() => {
    const c = { all: reviewRows.length, new: 0, update: 0, error: 0 };
    for (const r of reviewRows) c[r.status]++;
    return c;
  }, [reviewRows]);
  const visible = useMemo(
    () => reviewRows.filter((r) => (filter === "all" || r.status === filter) && matches(query, r.sku, r.row.name, r.row.category, r.message)),
    [reviewRows, filter, query],
  );
  const toImport = useMemo(() => (skipErrors ? reviewRows.filter((r) => r.status !== "error") : reviewRows), [reviewRows, skipErrors]);
  const qtyMapped = mapping ? Object.values(mapping).includes("qty") : false;

  const columns = useMemo<Column<ReviewRow>[]>(
    () => [
      { key: "line", header: "Row", width: "56px", align: "right", sortValue: (r) => r.line, render: (r) => <span className="text-text-tertiary">{r.line}</span> },
      { key: "sku", header: "SKU", sortValue: (r) => r.sku, render: (r) => <span className="font-mono text-[12.5px] text-text">{r.sku || <span className="text-text-tertiary">—</span>}</span> },
      {
        key: "name",
        header: "Name",
        sortValue: (r) => r.row.name ?? r.existing?.name ?? "",
        render: (r) => <span className="block max-w-[260px] truncate">{r.row.name ?? (r.existing ? <span className="text-text-tertiary">{r.existing.name}</span> : <span className="text-text-tertiary">—</span>)}</span>,
      },
      {
        key: "status",
        header: "Status",
        width: "96px",
        sortValue: (r) => r.status,
        render: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>,
      },
      { key: "qty", header: "Qty", align: "right", hideBelow: "sm", sortValue: (r) => r.row.qty ?? null, render: (r) => (r.row.qty !== undefined ? formatQty(r.row.qty, r.row.unit) : <span className="text-text-tertiary">—</span>) },
      { key: "unitCost", header: "Unit cost", align: "right", hideBelow: "md", sortValue: (r) => r.row.unitCost ?? null, render: (r) => (r.row.unitCost !== undefined ? formatMoney(r.row.unitCost, settings.currency) : <span className="text-text-tertiary">—</span>) },
      { key: "price", header: "Price", align: "right", hideBelow: "md", sortValue: (r) => r.row.price ?? null, render: (r) => (r.row.price !== undefined ? formatMoney(r.row.price, settings.currency) : <span className="text-text-tertiary">—</span>) },
      {
        key: "message",
        header: "Details",
        hideBelow: "lg",
        render: (r) =>
          r.message ? (
            <span className="text-[12.5px] text-critical">{r.message}</span>
          ) : (
            <span className="text-[12.5px] text-text-tertiary">{r.status === "update" ? "Updates existing item" : "Creates a new item"}</span>
          ),
      },
    ],
    [settings.currency],
  );

  const runImport = async () => {
    if (!writable || toImport.length === 0) return;
    setImporting(true);
    try {
      const result = await importItems(
        store,
        { id: user.id, name: user.name },
        toImport.map((r) => r.row),
        { setQuantities },
      );
      toast(`Imported ${result.created} new and ${result.updated} updated items`, "success");
      onDone(result, toImport.length);
    } catch (err) {
      toast(err instanceof InventoryError ? err.message : err instanceof Error ? err.message : "Import failed", "critical");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {!writable && (
        <Banner tone="warning" title="View-only access">
          Your role can review the file but not import it. Ask an owner or admin to run the import or change your role.
        </Banner>
      )}
      <div className="grid grid-cols-2 gap-3 @md:grid-cols-4">
        <SummaryTile label="Rows" value={counts.all} />
        <SummaryTile label="New items" value={counts.new} tone="success" />
        <SummaryTile label="Updates" value={counts.update} tone="info" />
        <SummaryTile label="Errors" value={counts.error} tone={counts.error ? "critical" : "default"} />
      </div>

      <Table
        rows={visible}
        columns={columns}
        rowKey={(r) => String(r.line)}
        pageSize={25}
        dense
        toolbar={
          <>
            <SearchField value={query} onChange={setQuery} placeholder="Search SKU, name or error" className="w-full sm:w-64" />
            <Segmented<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All", count: counts.all },
                { value: "new", label: "New", count: counts.new },
                { value: "update", label: "Update", count: counts.update },
                { value: "error", label: "Error", count: counts.error },
              ]}
            />
          </>
        }
        footer={`${pluralize(visible.length, "row")} shown`}
        emptyState={<EmptyState icon={<FileWarning />} title="No rows match" description={query ? "Try a different search." : "There are no rows with this status."} />}
      />

      <Card>
        <div className="flex flex-col gap-4">
          <Toggle
            label="Set on-hand quantities for existing items too"
            help={
              qtyMapped
                ? "Records a stock count movement that brings each existing item to the quantity in the file. New items always receive their quantity."
                : "No column is mapped to quantity, so this has no effect."
            }
            checked={setQuantities}
            onChange={setSetQuantities}
            disabled={!qtyMapped}
          />
          <Toggle
            label="Skip rows with errors"
            help={skipErrors ? `${pluralize(counts.error, "row")} with errors will be left out.` : "Rows with errors are sent anyway; unreadable values are dropped and the import reports what it could not do."}
            checked={skipErrors}
            onChange={setSkipErrors}
          />
        </div>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button icon={<ArrowLeft />} onClick={onBack} disabled={importing}>
          Back
        </Button>
        <Button variant="primary" icon={<Download />} loading={importing} disabled={!writable || toImport.length === 0} onClick={runImport}>
          Import {pluralize(toImport.length, "row")}
        </Button>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "success" | "info" | "critical" }) {
  const cls = { default: "text-text", success: "text-success", info: "text-info", critical: "text-critical" }[tone];
  return (
    <div className="card px-4 py-3">
      <div className="text-[12.5px] font-medium text-text-secondary">{label}</div>
      <div className={`mt-1 text-[20px] font-semibold leading-7 tabular ${cls}`}>{value}</div>
    </div>
  );
}
