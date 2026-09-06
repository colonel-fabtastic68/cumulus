"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Boxes, Download, FileDown, FilterX, Hammer, MoreHorizontal, Pencil, Plus, SlidersHorizontal, Sparkles, Trash2 } from "lucide-react";
import type { Item } from "@/lib/types";
import { deactivateItems, deleteItems, inventoryValue, isLowStock } from "@/lib/inventory";
import { useCollection, useItems, useItemsById, usePreview, useSettings, useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { formatMoney, formatNumber, pluralize, toDateInput } from "@/lib/format";
import { Button, Card, ConfirmDialog, EmptyState, IconButton, Menu, Page, SearchField, Segmented, Select, Table, useToast } from "@/components/ui";
import { AdjustStockModal } from "./AdjustStockModal";
import { BuildModal } from "./BuildModal";
import { ItemFormModal } from "./ItemFormModal";
import { BulkEditModal } from "./BulkEditModal";
import { useInventoryColumns } from "./InventoryColumns";
import { INVENTORY_VIEWS, describeFilters, matchesSearch, matchesView, type InventoryView } from "./inventoryFilters";
import { downloadCsv, itemsToCsv } from "./exportItemsCsv";

type Dialog = "new" | "adjust" | "build" | "bulk" | "deactivate" | "delete" | null;

const MAX_SKUS_IN_PROMPT = 40;

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface InventoryListProps {
  initialView?: InventoryView;
  initialQuery?: string;
}

export function InventoryList({ initialView = "all", initialQuery = "" }: InventoryListProps) {
  const router = useRouter();
  const store = useStore();
  const user = useCurrentUser();
  const writable = canWrite(user);
  const toast = useToast();
  const { open: openAgent, setPageContext } = useAgent();
  const settings = useSettings();
  const currency = settings.currency;
  const items = useItems();
  const byId = useItemsById();
  const { preview } = usePreview();
  const suppliers = useCollection("suppliers");

  const [q, setQ] = useState(initialQuery);
  const [view, setView] = useState<InventoryView>(initialView);
  const [category, setCategory] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const supplierName = useCallback((id?: string) => (id ? supplierById.get(id) : undefined), [supplierById]);
  const columns = useInventoryColumns({ currency, supplierName });

  const categories = useMemo(() => Array.from(new Set(items.map((i) => i.category).filter((c): c is string => !!c))).sort((a, b) => a.localeCompare(b)), [items]);
  const supplierOptions = useMemo(() => [...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map((s) => ({ value: s.id, label: s.name })), [suppliers]);

  // Search + category + supplier apply to every view; the view counts reflect them.
  const base = useMemo(
    () => items.filter((i) => matchesSearch(i, q) && (!category || i.category === category) && (!supplierId || i.supplierId === supplierId)),
    [items, q, category, supplierId],
  );
  const counts = useMemo(() => {
    const out: Record<InventoryView, number> = { all: 0, active: 0, low: 0, assemblies: 0, inactive: 0 };
    for (const i of base) for (const v of INVENTORY_VIEWS) if (matchesView(i, v.value)) out[v.value]++;
    return out;
  }, [base]);
  const rows = useMemo(() => base.filter((i) => matchesView(i, view)), [base, view]);

  const lowCount = useMemo(() => items.filter(isLowStock).length, [items]);
  const totalValue = useMemo(() => inventoryValue(items), [items]);
  const viewValue = useMemo(() => inventoryValue(rows), [rows]);
  const filtersActive = q.trim() !== "" || view !== "all" || category !== "" || supplierId !== "";

  // Selection pruned to items that still exist.
  const selectedIds = useMemo(() => new Set(Array.from(selected).filter((id) => byId.has(id))), [selected, byId]);
  const selectedItems = useMemo(() => Array.from(selectedIds).map((id) => byId.get(id)).filter((i): i is Item => !!i), [selectedIds, byId]);
  const selectedSkus = useMemo(() => selectedItems.map((i) => i.sku), [selectedItems]);

  useEffect(() => {
    setPageContext({ page: "Inventory list", selectedSkus });
    return () => setPageContext({});
  }, [setPageContext, selectedSkus]);

  const closeDialog = useCallback(() => setDialog(null), []);
  const clearFilters = () => {
    setQ("");
    setView("all");
    setCategory("");
    setSupplierId("");
  };

  const exportCsv = () => {
    if (rows.length === 0) return toast("Nothing to export in this view");
    downloadCsv(`inventory-${toDateInput()}.csv`, itemsToCsv(rows, supplierName));
    toast(`Exported ${pluralize(rows.length, "item")} to CSV`, "success");
  };

  const askAboutView = () => {
    const skus = rows.slice(0, MAX_SKUS_IN_PROMPT).map((i) => i.sku);
    const filters = describeFilters({ q, view, category, supplierId }, supplierName(supplierId));
    const listing = rows.length === 0 ? "It is empty." : rows.length > MAX_SKUS_IN_PROMPT ? `The first ${MAX_SKUS_IN_PROMPT} SKUs are: ${skus.join(", ")}.` : `The SKUs are: ${skus.join(", ")}.`;
    openAgent(`I'm looking at the Inventory list with ${filters} (${pluralize(rows.length, "item")}, value ${formatMoney(viewValue, currency)}). ${listing} `, { send: false });
  };

  const askAboutSelection = () => {
    openAgent(`I have selected these SKUs: ${selectedSkus.join(", ")}; `, { send: false });
  };

  const runBulk = async (label: string, fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      toast(label, "success");
      setSelected(new Set());
      setDialog(null);
    } catch (e) {
      toast(errorMessage(e), "critical");
    } finally {
      setBusy(false);
    }
  };

  const deactivateSelected = () => {
    const ids = Array.from(selectedIds);
    void runBulk(`Deactivated ${pluralize(ids.length, "item")}`, async () => {
      await deactivateItems(store, user, ids);
    });
  };

  const deleteSelected = () => {
    const ids = Array.from(selectedIds);
    void runBulk(`Deleted ${pluralize(ids.length, "item")}`, () => deleteItems(store, user, ids));
  };

  const subtitle = `${pluralize(items.length, "item")} · ${formatNumber(lowCount)} below minimum · value ${formatMoney(totalValue, currency)}`;

  const moreMenu = (
    <Menu
      trigger={<IconButton aria-label="More actions" icon={<MoreHorizontal />} />}
      items={[
        { label: "Export CSV", icon: <FileDown />, onSelect: exportCsv, disabled: rows.length === 0 },
        { label: "Ask Nimbus about this view", icon: <Sparkles />, onSelect: askAboutView },
      ]}
    />
  );

  const secondaryActions = writable ? (
    <>
      <Button icon={<SlidersHorizontal />} onClick={() => setDialog("adjust")} disabled={items.length === 0}>
        Adjust stock
      </Button>
      <Button icon={<Hammer />} onClick={() => setDialog("build")} disabled={items.length === 0}>
        Build
      </Button>
      <Button icon={<Download />} href="/import">
        Import
      </Button>
      {moreMenu}
    </>
  ) : (
    moreMenu
  );

  const toolbar = (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <SearchField value={q} onChange={setQ} placeholder="Search SKU, name, tag, barcode, location" className="w-full sm:w-72" />
      <div className="max-w-full overflow-x-auto">
        <Segmented value={view} onChange={setView} options={INVENTORY_VIEWS.map((v) => ({ value: v.value, label: v.label, count: counts[v.value] }))} />
      </div>
      <Select value={category} onChange={(e) => setCategory(e.target.value)} placeholder="All categories" options={categories.map((c) => ({ value: c, label: c }))} containerClassName="w-full sm:w-44" aria-label="Category" />
      <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} placeholder="All suppliers" options={supplierOptions} containerClassName="w-full sm:w-48" aria-label="Supplier" />
    </div>
  );

  const bulkActions = (sel: Set<string>) => (
    <>
      {writable && (
        <>
          <Button size="sm" icon={<Pencil />} onClick={() => setDialog("bulk")}>
            Edit fields
          </Button>
          <Button size="sm" icon={<Archive />} onClick={() => setDialog("deactivate")}>
            Deactivate
          </Button>
          <Button size="sm" icon={<Trash2 />} onClick={() => setDialog("delete")} className="text-critical hover:bg-critical-soft">
            Delete
          </Button>
        </>
      )}
      <Button size="sm" icon={<Sparkles />} onClick={askAboutSelection} disabled={sel.size === 0}>
        Ask Nimbus
      </Button>
    </>
  );

  const sampleSkus = selectedSkus.slice(0, 5).join(", ") + (selectedSkus.length > 5 ? ` and ${selectedSkus.length - 5} more` : "");

  return (
    <Page
      title="Inventory"
      subtitle={subtitle}
      wide
      primaryAction={
        writable ? (
          <Button variant="primary" icon={<Plus />} onClick={() => setDialog("new")}>
            New item
          </Button>
        ) : undefined
      }
      secondaryActions={secondaryActions}
    >
      {items.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={<Boxes />}
            title="No items yet"
            description={writable ? "Import a spreadsheet from your old system, or create your first part to get started." : "Nothing has been added to this workspace yet."}
            action={
              writable ? (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button icon={<Download />} href="/import">
                    Import
                  </Button>
                  <Button variant="primary" icon={<Plus />} onClick={() => setDialog("new")}>
                    New item
                  </Button>
                </div>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Table
          rows={rows}
          columns={columns}
          rowKey={(i) => i.id}
          rowClassName={(i) => (preview?.patches[i.id] ? "preview-row" : undefined)}
          onRowClick={(i) => router.push("/inventory/" + i.id)}
          selectable
          selected={selectedIds}
          onSelectedChange={setSelected}
          pageSize={50}
          defaultSort={{ key: "sku", dir: "asc" }}
          toolbar={toolbar}
          bulkActions={bulkActions}
          footer={`${pluralize(rows.length, "item")}${filtersActive ? ` of ${formatNumber(items.length)}` : ""} · value ${formatMoney(viewValue, currency)}`}
          emptyState={
            <EmptyState
              icon={<FilterX />}
              title="No items match"
              description="Try a different search, or clear the filters to see everything."
              action={
                <Button icon={<FilterX />} onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          }
        />
      )}

      <ItemFormModal open={dialog === "new"} onClose={closeDialog} />
      <AdjustStockModal open={dialog === "adjust"} onClose={closeDialog} />
      <BuildModal open={dialog === "build"} onClose={closeDialog} />
      <BulkEditModal open={dialog === "bulk"} onClose={closeDialog} items={selectedItems} onDone={() => setSelected(new Set())} />
      <ConfirmDialog
        open={dialog === "deactivate"}
        onClose={closeDialog}
        onConfirm={deactivateSelected}
        loading={busy}
        title={`Deactivate ${pluralize(selectedIds.size, "item")}?`}
        confirmLabel="Deactivate"
        message={
          <>
            {sampleSkus} will be marked inactive. They keep their stock and history, but drop out of the active view, low-stock alerts and the item picker. You can reactivate them
            at any time.
          </>
        }
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={closeDialog}
        onConfirm={deleteSelected}
        loading={busy}
        destructive
        title={`Delete ${pluralize(selectedIds.size, "item")}?`}
        confirmLabel="Delete permanently"
        message={
          <>
            This permanently removes {sampleSkus} together with their stock movements, lots and history, and strips them from any bill of materials. This can&apos;t be undone.
            If you only want to retire them, choose Deactivate instead.
          </>
        }
      />
    </Page>
  );
}
