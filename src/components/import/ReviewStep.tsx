"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Download, FileWarning, Layers, Package, Plus, Trash2, Undo2 } from "lucide-react";
import { Badge, Banner, Button, Card, Drawer, EmptyState, Modal, SearchField, Segmented, Table, Toggle, useToast, type Column, type ComboboxOption } from "@/components/ui";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { formatMoney, formatQty, pluralize } from "@/lib/format";
import type { ImportBomLine } from "@/lib/importBoms";
import { importItems, InventoryError, type ImportResult } from "@/lib/inventory";
import { useItemsBySku, useSettings, useStore } from "@/lib/store/provider";
import { useFeature } from "@/lib/useFeature";
import { describeAnswers } from "@/lib/onboarding";
import { matches } from "@/lib/utils";
import { buildReviewRows } from "./convert";
import { ImportChanges } from "./ImportChanges";
import { RowEditor } from "./RowEditor";
import { StratoFill, type Overrides } from "./StratoFill";
import type { ColumnMapping, ParsedSource, ReviewRow, ReviewStatus, RowChanges, RowEdit, RowEdits } from "./types";

type Filter = "all" | ReviewStatus;

const STATUS_TONE: Record<ReviewStatus, "success" | "info" | "critical"> = { new: "success", update: "info", error: "critical" };
const STATUS_LABEL: Record<ReviewStatus, string> = { new: "New", update: "Update", error: "Error" };

interface ReviewStepProps {
  source: ParsedSource;
  mapping: ColumnMapping;
  fillSkus?: boolean;
  /** Values Strato filled into blank cells, by 1-based line. Kept by the wizard so Back does not lose them. */
  overrides?: Overrides;
  onOverrides?: (next: Overrides) => void;
  /** Rows changed by hand (feature `importEditing`). Kept by the wizard so Back does not lose them. */
  edits?: RowEdits;
  onEdits?: (next: RowEdits) => void;
  /** Rows added or left out by hand (feature `importEditing`). */
  rowChanges?: RowChanges;
  onRowChanges?: (next: RowChanges) => void;
  onBack: () => void;
  onDone: (result: ImportResult, attempted: number) => void;
}

const NO_OVERRIDES: Overrides = new Map();
const NO_EDITS: RowEdits = new Map();
const NO_ROW_CHANGES: RowChanges = { added: 0, removed: new Set() };
const TYPE_LABEL: Record<string, string> = { part: "Part", assembly: "Assembly" };

export function ReviewStep({ source, mapping, fillSkus, overrides = NO_OVERRIDES, onOverrides, edits = NO_EDITS, onEdits, rowChanges = NO_ROW_CHANGES, onRowChanges, onBack, onDone }: ReviewStepProps) {
  const store = useStore();
  const user = useCurrentUser();
  const settings = useSettings();
  const itemsBySku = useItemsBySku();
  const toast = useToast();
  const writable = canWrite(user);
  const editing = useFeature("importEditing") && !!onEdits && !!onRowChanges && writable;

  const [setQuantities, setSetQuantities] = useState(false);
  const [skipErrors, setSkipErrors] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [importing, setImporting] = useState(false);
  const [openLine, setOpenLine] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [tickedWarning, setTickedWarning] = useState(false);

  const sourceKind = source.kind === "generic" ? undefined : source.kind;
  const activeEdits = editing ? edits : NO_EDITS;
  const { added, removed } = editing ? rowChanges : NO_ROW_CHANGES;
  const fileLength = source.rows.length;
  /** The file's rows plus the blank ones added here, which are filled in through edits. */
  const sourceRows = useMemo(() => (added ? [...source.rows, ...Array.from({ length: added }, () => ({}))] : source.rows), [source.rows, added]);
  const reshaped = added > 0 || removed.size > 0;
  /** The file on its own, for counting what Strato could fill; the rows below carry the fills. */
  const bareRows = useMemo(() => buildReviewRows(source.rows, mapping, itemsBySku, sourceKind, { fillSkus }), [source.rows, mapping, itemsBySku, sourceKind, fillSkus]);
  /** The file with Strato's fills, added rows and removals: what a hand edit is measured against. */
  const uneditedRows = useMemo(
    () => (overrides.size || reshaped ? buildReviewRows(sourceRows, mapping, itemsBySku, sourceKind, { fillSkus, overrides, skip: removed }) : bareRows),
    [bareRows, reshaped, sourceRows, mapping, itemsBySku, sourceKind, fillSkus, overrides, removed],
  );
  const reviewRows = useMemo(
    () => (activeEdits.size ? buildReviewRows(sourceRows, mapping, itemsBySku, sourceKind, { fillSkus, overrides, edits: activeEdits, skip: removed }) : uneditedRows),
    [uneditedRows, sourceRows, mapping, itemsBySku, sourceKind, fillSkus, overrides, activeEdits, removed],
  );
  const editedCount = useMemo(() => reviewRows.filter((r) => r.edited && r.line <= fileLength).length, [reviewRows, fileLength]);
  const addedCount = useMemo(() => reviewRows.filter((r) => r.line > fileLength).length, [reviewRows, fileLength]);
  /** Removed rows worth bringing back: the file's own, and added rows someone filled in. */
  const restorable = [...removed].filter((line) => line <= fileLength || edits.has(line));

  /** What a component can be: rows of this file that import cleanly, then items already in inventory. */
  const candidates = useMemo<ComboboxOption[]>(() => {
    if (!editing) return [];
    const out = new Map<string, ComboboxOption>();
    for (const r of reviewRows) if (r.sku && r.status !== "error") out.set(r.sku, { value: r.sku, label: `${r.sku} · ${r.row.name ?? r.existing?.name ?? ""}`, description: r.existing ? "In inventory, updated by this file" : "New in this file" });
    for (const item of itemsBySku.values()) {
      const sku = item.sku.toUpperCase();
      if (!out.has(sku)) out.set(sku, { value: sku, label: `${item.sku} · ${item.name}`, description: "In inventory" });
    }
    return [...out.values()];
  }, [editing, reviewRows, itemsBySku]);
  const skuById = useMemo(() => new Map([...itemsBySku.values()].map((i) => [i.id, i.sku.toUpperCase()])), [itemsBySku]);
  const existingBomOf = (r: ReviewRow): ImportBomLine[] => (r.existing?.type === "assembly" ? r.existing.bom.flatMap((l) => (skuById.has(l.itemId) ? [{ sku: skuById.get(l.itemId)!, qty: l.qty }] : [])) : []);

  const saveEdit = (line: number, edit: RowEdit | null) => {
    const next = new Map(edits);
    if (edit) next.set(line, edit);
    else next.delete(line);
    onEdits?.(next);
  };
  const markType = (keys: Set<string>, type: "part" | "assembly") => {
    const next = new Map(edits);
    for (const key of keys) {
      const line = Number(key);
      const edit: RowEdit = { ...(next.get(line) ?? {}), type };
      if (type === "part") delete edit.bom;
      next.set(line, edit);
    }
    onEdits?.(next);
    toast(`${pluralize(keys.size, "row")} marked as ${type === "assembly" ? "assemblies" : "parts"}`, "success");
    setSelected(new Set());
  };
  const removeLines = (lines: number[], quiet = false) => {
    if (lines.length === 0) return;
    onRowChanges?.({ added, removed: new Set([...removed, ...lines]) });
    setSelected(new Set());
    if (!quiet) toast(`${pluralize(lines.length, "row")} left out of this import`, "success");
  };
  const restoreRemoved = () => onRowChanges?.({ added, removed: new Set([...removed].filter((line) => !restorable.includes(line))) });
  const addRow = () => {
    const line = fileLength + added + 1;
    onRowChanges?.({ added: added + 1, removed });
    setOpenLine(line);
  };
  /** Closing the panel on an added row that was never filled in drops the row again. */
  const closePanel = () => {
    if (openLine !== null && openLine > fileLength && !edits.has(openLine)) removeLines([openLine], true);
    setOpenLine(null);
  };
  const openRow = openLine === null ? undefined : reviewRows.find((r) => r.line === openLine);
  const openBase = openLine === null ? undefined : uneditedRows.find((r) => r.line === openLine);
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
      { key: "sku", header: "SKU", sortValue: (r) => r.sku, render: (r) => (
          <span className="font-mono text-[12.5px] text-text">
            {r.sku || <span className="text-text-tertiary">—</span>}
            {r.skuFilled && <span className="ml-1.5 font-sans text-[11.5px] text-text-tertiary">{r.skuFilled === "matched" ? "matched by name" : r.skuFilled === "strato" ? "from Strato" : "made from name"}</span>}
          </span>
        ) },
      {
        key: "name",
        header: "Name",
        sortValue: (r) => r.row.name ?? r.existing?.name ?? "",
        render: (r) => (
          <span className="flex max-w-[300px] items-center gap-1.5">
            <span className="truncate">{r.row.name ?? (r.existing ? <span className="text-text-tertiary">{r.existing.name}</span> : <span className="text-text-tertiary">—</span>)}</span>
            {r.line > fileLength ? <span className="shrink-0 text-[11.5px] text-text-tertiary">added here</span> : r.edited && <span className="shrink-0 text-[11.5px] text-text-tertiary">edited</span>}
          </span>
        ),
      },
      ...(editing
        ? ([
            {
              key: "type",
              header: "Type",
              width: "104px",
              sortValue: (r) => r.row.type ?? r.existing?.type ?? "part",
              render: (r) => {
                const t = r.row.type ?? r.existing?.type ?? "part";
                return t === "assembly" ? <Badge tone="info">{TYPE_LABEL[t]}</Badge> : <span className="text-text-secondary">{TYPE_LABEL[t] ?? t}</span>;
              },
            },
            {
              key: "parts",
              header: "Parts",
              width: "72px",
              align: "right",
              sortValue: (r) => r.row.bom?.length ?? (r.existing?.type === "assembly" ? r.existing.bom.length : null),
              render: (r) => {
                const t = r.row.type ?? r.existing?.type;
                if (t !== "assembly") return <span className="text-text-tertiary">—</span>;
                const n = r.row.bom?.length ?? r.existing?.bom.length ?? 0;
                return n > 0 ? <span className="tabular">{n}</span> : <span className="text-[12px] text-warning">None</span>;
              },
            },
          ] satisfies Column<ReviewRow>[])
        : []),
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
    [settings.currency, editing, fileLength],
  );

  /** Rows that will be saved as assemblies, so the count can be checked before importing. */
  const assemblyCount = useMemo(() => toImport.filter((r) => (r.row.type ?? r.existing?.type) === "assembly").length, [toImport]);

  /** Ticking a row only selects it; importing with rows still ticked asks first, since the ticks change nothing on their own. */
  const requestImport = () => {
    if (editing && selected.size > 0) setTickedWarning(true);
    else void runImport();
  };

  const runImport = async () => {
    setTickedWarning(false);
    if (!writable || toImport.length === 0) return;
    setImporting(true);
    try {
      const result = await importItems(
        store,
        { id: user.id, name: user.name },
        toImport.map((r) => r.row),
        { setQuantities },
      );
      toast(`Imported ${result.created} new and ${result.updated} updated items${result.bomsSet ? `, with ${pluralize(result.bomsSet, "parts list")}` : ""}`, "success");
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
      <div className={editing ? "grid grid-cols-2 gap-3 @md:grid-cols-5" : "grid grid-cols-2 gap-3 @md:grid-cols-4"}>
        <SummaryTile label="Rows" value={counts.all} />
        <SummaryTile label="New items" value={counts.new} tone="success" />
        <SummaryTile label="Updates" value={counts.update} tone="info" />
        <SummaryTile label="Errors" value={counts.error} tone={counts.error ? "critical" : "default"} />
        {editing && <SummaryTile label="Assemblies" value={assemblyCount} tone={assemblyCount ? "info" : "default"} />}
      </div>
      {onOverrides && <StratoFill source={source} mapping={mapping} rows={bareRows} itemsBySku={itemsBySku} overrides={overrides} onOverrides={onOverrides} hint={describeAnswers(settings.onboarding)} />}
      <ImportChanges rows={reviewRows} />

      {editing && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-text-secondary">
          <span>
            Click a row to change it or give an assembly its parts list. To change several at once, tick them, then choose <span className="font-medium text-text">Mark as assembly</span>, <span className="font-medium text-text">Mark as part</span> or <span className="font-medium text-text">Remove from import</span> in the bar above the table. Ticking alone changes nothing.
          </span>
          {(editedCount > 0 || addedCount > 0 || restorable.length > 0) && (
            <span className="text-text">
              {[editedCount > 0 && `${pluralize(editedCount, "row")} changed`, addedCount > 0 && `${pluralize(addedCount, "row")} added`, restorable.length > 0 && `${pluralize(restorable.length, "row")} left out`].filter(Boolean).join(", ")}.
            </span>
          )}
          {restorable.length > 0 && (
            <Button size="sm" variant="plain" icon={<Undo2 />} onClick={restoreRemoved}>
              Bring back rows left out
            </Button>
          )}
        </div>
      )}

      <Table
        rows={visible}
        columns={columns}
        rowKey={(r) => String(r.line)}
        rowLabel={(r) => `row ${r.line}${r.sku ? `, ${r.sku}` : ""}`}
        pageSize={25}
        dense
        lockHeader={editing}
        lockToolbar={editing}
        onRowClick={editing ? (r) => setOpenLine(r.line) : undefined}
        selectable={editing}
        selected={selected}
        onSelectedChange={setSelected}
        bulkActions={
          editing
            ? (sel) => (
                <>
                  <Button size="sm" icon={<Layers />} onClick={() => markType(sel, "assembly")}>
                    Mark as assembly
                  </Button>
                  <Button size="sm" icon={<Package />} onClick={() => markType(sel, "part")}>
                    Mark as part
                  </Button>
                  <Button size="sm" icon={<Trash2 />} onClick={() => removeLines([...sel].map(Number))}>
                    Remove from import
                  </Button>
                  {sel.size < visible.length && (
                    <Button size="sm" variant="plain" onClick={() => setSelected(new Set(visible.map((r) => String(r.line))))}>
                      Select all {visible.length} shown
                    </Button>
                  )}
                </>
              )
            : undefined
        }
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
            {editing && (
              <Button size="sm" icon={<Plus />} onClick={addRow} className="ml-auto">
                Add a part
              </Button>
            )}
          </>
        }
        footer={`${pluralize(visible.length, "row")} shown`}
        emptyState={<EmptyState icon={<FileWarning />} title="No rows match" description={query ? "Try a different search." : "There are no rows with this status."} />}
      />

      {editing && (
        <Drawer
          open={!!openRow}
          onClose={closePanel}
          title={openRow ? (openRow.line > fileLength && !openRow.edited ? "New part" : `Row ${openRow.line}${openRow.sku ? ` · ${openRow.sku}` : ""}`) : undefined}
          subtitle={openRow && openRow.line > fileLength ? "Added to this import only. Your file is not changed." : "Changes apply to this import only. Your file is not changed."}
          width={620}
        >
          {openRow && openBase && (
            <RowEditor
              key={openRow.line}
              row={openRow}
              base={openBase.row}
              existingBom={existingBomOf(openRow)}
              candidates={candidates}
              isNew={openRow.line > fileLength}
              onSave={(edit) => {
                // An added row saved with nothing in it is dropped rather than left as an empty error row.
                if (!edit && openRow.line > fileLength) removeLines([openRow.line], true);
                else saveEdit(openRow.line, edit);
                setOpenLine(null);
              }}
              onRemove={() => {
                removeLines([openRow.line], openRow.line > fileLength && !openRow.edited);
                setOpenLine(null);
              }}
              onClose={closePanel}
            />
          )}
        </Drawer>
      )}

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
        <Button variant="primary" icon={<Download />} loading={importing} disabled={!writable || toImport.length === 0} onClick={requestImport}>
          Import {pluralize(toImport.length, "row")}
        </Button>
      </div>

      <Modal
        open={tickedWarning}
        onClose={() => setTickedWarning(false)}
        title={`${pluralize(selected.size, "row is", "rows are")} ticked but not changed`}
        subtitle="Ticking a row only selects it."
        footer={
          <>
            <Button variant="plain" onClick={() => void runImport()}>
              Import without changing them
            </Button>
            <Button
              onClick={() => {
                setTickedWarning(false);
                markType(selected, "part");
              }}
            >
              Mark as parts
            </Button>
            <Button
              variant="primary"
              icon={<Layers />}
              onClick={() => {
                setTickedWarning(false);
                markType(selected, "assembly");
              }}
            >
              Mark as assemblies
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-text-secondary">
          Did you mean to change them first? Marking them updates the Type column and the Assemblies count; check them, then click Import again. Importing now saves them as they are shown.
        </p>
      </Modal>
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
