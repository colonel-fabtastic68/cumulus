"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileDown, FilterX, Image as ImageIcon, MoreHorizontal, Pencil, Plus, Printer, QrCode, Share2, Tags, Trash2 } from "lucide-react";
import { Badge, Button, Card, ConfirmDialog, EmptyState, IconButton, Menu, Page, SearchField, Segmented, Select, Table, useToast, type Column } from "@/components/ui";
import { useAgent } from "@/components/agent/AgentProvider";
import { csvFilename, downloadCsv } from "@/components/reports/csv";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { downloadBlob } from "@/lib/export/formats";
import { formatDate, formatNumber, pluralize } from "@/lib/format";
import { SYMBOLOGIES, isTwoD, type Symbology } from "@/lib/labels/spec";
import { carriesLabel, codableItems, codeDrawing, deleteCodes, hasSavedCode, printedBeside, symbologyLabel, type CodedItem } from "@/lib/savedCodes";
import { useItems, useSettings, useStore } from "@/lib/store/provider";
import { useTerms } from "@/lib/useTerms";
import { matches } from "@/lib/utils";
import { CodeThumb, useOrigin } from "./CodeArt";
import { CodeDrawer } from "./CodeDrawer";
import { EditCodesModal } from "./EditCodesModal";
import { PrintCodesModal, rememberedSheet } from "./PrintCodesModal";
import { codePng, codesCsv, shareOrDownload, sheetPdf } from "./codeFiles";
import { clearHandoff, peekHandoff, type LabelsHandoff } from "./handoff";

const NEW = "/exports/labels/new";
const SHEET = "/exports/labels/sheet";
/** More images than this in one go and the browser starts blocking the downloads: the PDF sheet is the way for a big batch. */
const MAX_IMAGES = 25;

type Shape = "all" | "square" | "bars";
type Dialog = { kind: "print" | "edit" | "delete"; ids: string[] } | null;

/**
 * Labels & barcodes: the codes made for each item, in a list that works like
 * Inventory. Search, filter and tick them, then print, export, share, edit or
 * delete; a row opens that item's code. "New codes" walks through making them.
 */
export function CodeLibrary() {
  const router = useRouter();
  const store = useStore();
  const user = useCurrentUser();
  const writable = canWrite(user);
  const toast = useToast();
  const settings = useSettings();
  const terms = useTerms();
  const allItems = useItems();
  const origin = useOrigin();
  const { setPageContext } = useAgent();

  const coded = useMemo(() => allItems.filter(hasSavedCode), [allItems]);
  const byId = useMemo(() => new Map(coded.map((i) => [i.id, i])), [coded]);
  const codable = useMemo(() => codableItems(allItems).length, [allItems]);

  // Codes just made in the steps, or sent over from Inventory, arrive ticked and ready to print.
  const [handed] = useState<LabelsHandoff | null>(() => peekHandoff());
  const [selected, setSelected] = useState<Set<string>>(() => new Set(handed?.select ?? []));
  const [notice, setNotice] = useState(handed?.made ?? null);
  useEffect(() => {
    clearHandoff();
  }, []);

  const [q, setQ] = useState("");
  const [shape, setShape] = useState<Shape>("all");
  const [symbology, setSymbology] = useState<Symbology | "">("");
  const [category, setCategory] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPageContext({ page: "Labels & barcodes" });
    return () => setPageContext({});
  }, [setPageContext]);

  const categories = useMemo(() => Array.from(new Set(coded.map((i) => i.category).filter((c): c is string => !!c))).sort((a, b) => a.localeCompare(b)), [coded]);
  const kindsInUse = useMemo(() => SYMBOLOGIES.filter((s) => coded.some((i) => i.savedCode.symbology === s.id)), [coded]);

  // Search, kind and category apply to every tab; the tab counts reflect them.
  const base = useMemo(() => coded.filter((i) => matches(q, i.sku, i.name, i.category, i.barcode, i.location) && (!symbology || i.savedCode.symbology === symbology) && (!category || i.category === category)), [coded, q, symbology, category]);
  const counts = useMemo(() => {
    const square = base.filter((i) => isTwoD(i.savedCode.symbology)).length;
    return { all: base.length, square, bars: base.length - square };
  }, [base]);
  const rows = useMemo(() => (shape === "all" ? base : base.filter((i) => isTwoD(i.savedCode.symbology) === (shape === "square"))), [base, shape]);
  const filtersActive = q.trim() !== "" || shape !== "all" || symbology !== "" || category !== "";
  const clearFilters = () => {
    setQ("");
    setShape("all");
    setSymbology("");
    setCategory("");
  };

  // Selection pruned to codes that still exist.
  const selectedIds = useMemo(() => new Set(Array.from(selected).filter((id) => byId.has(id))), [selected, byId]);
  const pick = (ids: string[]): CodedItem[] => ids.map((id) => byId.get(id)).filter((i): i is CodedItem => !!i);
  const opened = openId ? byId.get(openId) : undefined;
  const dialogItems = dialog ? pick(dialog.ids) : [];

  const columns = useMemo<Column<CodedItem>[]>(
    () => [
      { key: "code", header: "Code", minWidth: 96, maxWidth: 96, render: (i) => <CodeThumb item={i} code={i.savedCode} origin={origin} /> },
      {
        key: "sku",
        header: terms.itemCodeShort,
        flex: true,
        minWidth: 160,
        sortValue: (i) => i.sku,
        render: (i) => (
          <div className="min-w-0">
            <div className="font-mono text-[12px] font-medium text-text">{i.sku}</div>
            <div className="truncate text-[12.5px] text-text-secondary" title={i.name}>
              {i.name}
            </div>
          </div>
        ),
      },
      {
        key: "kind",
        header: "Kind",
        minWidth: 110,
        maxWidth: 220,
        sortValue: (i) => symbologyLabel(i.savedCode.symbology),
        render: (i) => (
          <span className="flex flex-wrap items-center gap-1">
            <Badge tone={isTwoD(i.savedCode.symbology) ? "info" : "default"}>{symbologyLabel(i.savedCode.symbology)}</Badge>
            {codeDrawing(i, i.savedCode, origin).standIn && <Badge tone="warning">No barcode number</Badge>}
          </span>
        ),
      },
      { key: "carries", header: "Carries", minWidth: 120, maxWidth: 170, priority: 2, sortValue: (i) => carriesLabel(i.savedCode, terms.itemCodeShort), render: (i) => carriesLabel(i.savedCode, terms.itemCodeShort) },
      { key: "beside", header: "Printed beside", minWidth: 130, maxWidth: 200, priority: 5, render: (i) => <span className="text-text-secondary">{printedBeside(i.savedCode, terms.itemCodeShort)}</span> },
      { key: "category", header: "Category", minWidth: 90, maxWidth: 150, priority: 3, sortValue: (i) => i.category ?? "", render: (i) => (i.category ? <span className="block truncate" title={i.category}>{i.category}</span> : <span className="text-text-tertiary">—</span>) },
      { key: "bin", header: "Bin", minWidth: 70, maxWidth: 120, priority: 4, sortValue: (i) => i.location ?? "", render: (i) => (i.location ? <span className="font-mono text-[12px]">{i.location}</span> : <span className="text-text-tertiary">—</span>) },
      { key: "made", header: "Made", minWidth: 96, maxWidth: 130, priority: 1, firstSortDir: "desc", sortValue: (i) => i.savedCode.updatedAt ?? i.savedCode.createdAt, render: (i) => <span className="tabular text-text-secondary">{formatDate(i.savedCode.updatedAt ?? i.savedCode.createdAt)}</span> },
    ],
    [origin, terms.itemCodeShort],
  );

  const exportCsv = (items: CodedItem[]) => {
    if (items.length === 0) return toast("No codes to export in this view");
    const { headers, rows: csvRows } = codesCsv(items, origin, terms);
    downloadCsv(csvFilename("codes"), headers, csvRows);
    toast(`Exported ${pluralize(items.length, "code")} to CSV`, "success");
  };

  const guarded = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(false);
    }
  };

  const exportImages = (items: CodedItem[]) => {
    if (items.length > MAX_IMAGES) return toast(`Tick ${MAX_IMAGES} or fewer to download as images, or print them to a PDF sheet`, "critical");
    void guarded(async () => {
      for (const i of items) {
        const f = await codePng(i, i.savedCode, origin);
        downloadBlob(f.name, f);
      }
      toast(`Downloaded ${pluralize(items.length, "image")}`, "success");
    });
  };

  /** One code shares as its image; several share as a PDF sheet on the stock used last. */
  const share = (items: CodedItem[]) =>
    void guarded(async () => {
      if (items.length === 1) {
        const i = items[0]!;
        if ((await shareOrDownload(await codePng(i, i.savedCode, origin), `${i.sku} · ${i.name}`)) === "downloaded") toast("This browser has no share sheet, so the image was downloaded instead", "success");
        return;
      }
      const out = await sheetPdf(items, rememberedSheet(), { origin, currency: settings.currency });
      if ((await shareOrDownload(out.file, out.file.name)) === "downloaded") toast("This browser has no share sheet, so the PDF was downloaded instead", "success");
    });

  const remove = () => {
    if (!dialog) return;
    const ids = dialog.ids;
    void guarded(async () => {
      const removed = await deleteCodes(store, user, ids);
      toast(removed === 1 ? "Deleted the code" : `Deleted ${formatNumber(removed)} codes`, "success");
      setSelected((prev) => new Set(Array.from(prev).filter((id) => !ids.includes(id))));
      if (openId && ids.includes(openId)) setOpenId(null);
      setDialog(null);
    });
  };

  const toolbar = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <SearchField value={q} onChange={setQ} placeholder={`Search ${terms.itemCodeShort}, name, barcode or bin`} className="w-full sm:w-72" />
      <div className="min-w-0 max-w-full overflow-x-auto">
        <Segmented<Shape>
          value={shape}
          onChange={setShape}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "square", label: "Square codes", count: counts.square },
            { value: "bars", label: "Bars", count: counts.bars },
          ]}
        />
      </div>
      {kindsInUse.length > 1 && <Select value={symbology} onChange={(e) => setSymbology(e.target.value as Symbology | "")} options={[{ value: "", label: "All kinds" }, ...kindsInUse.map((s) => ({ value: s.id, label: s.label }))]} containerClassName="w-full sm:w-40" aria-label="Kind of code" />}
      {categories.length > 0 && <Select value={category} onChange={(e) => setCategory(e.target.value)} options={[{ value: "", label: "All categories" }, ...categories.map((c) => ({ value: c, label: c }))]} containerClassName="w-full sm:w-44" aria-label="Category" />}
      {filtersActive && (
        <Button variant="plain" icon={<FilterX />} onClick={clearFilters}>
          Reset filters
        </Button>
      )}
    </div>
  );

  const bulkActions = (sel: Set<string>) => {
    const ids = Array.from(sel).filter((id) => byId.has(id));
    return (
      <>
        <Button size="sm" icon={<Printer />} onClick={() => setDialog({ kind: "print", ids })} disabled={ids.length === 0}>
          Print
        </Button>
        <Menu
          align="left"
          trigger={
            <Button size="sm" icon={<Download />} loading={busy} disabled={ids.length === 0}>
              Export
            </Button>
          }
          items={[
            { label: "Label sheet (PDF)…", icon: <FileDown />, onSelect: () => setDialog({ kind: "print", ids }) },
            { label: "Images (PNG)", icon: <ImageIcon />, onSelect: () => exportImages(pick(ids)) },
            { label: "List (CSV)", icon: <FileDown />, onSelect: () => exportCsv(pick(ids)) },
          ]}
        />
        <Button size="sm" icon={<Share2 />} onClick={() => share(pick(ids))} disabled={ids.length === 0 || busy}>
          Share
        </Button>
        {writable && (
          <>
            <Button size="sm" icon={<Pencil />} onClick={() => setDialog({ kind: "edit", ids })} disabled={ids.length === 0}>
              Edit
            </Button>
            <Button size="sm" icon={<Trash2 />} onClick={() => setDialog({ kind: "delete", ids })} disabled={ids.length === 0} className="text-critical hover:bg-critical-soft">
              Delete
            </Button>
          </>
        )}
      </>
    );
  };

  const newCodes = writable ? (
    <Button variant="primary" icon={<Plus />} onClick={() => router.push(NEW)}>
      New codes
    </Button>
  ) : undefined;

  const sample = dialogItems.slice(0, 5).map((i) => i.sku).join(", ") + (dialogItems.length > 5 ? ` and ${dialogItems.length - 5} more` : "");

  return (
    <Page
      title="Labels & barcodes"
      subtitle={coded.length === 0 ? "The barcode or QR code made for each item, kept here to print, export or share." : `${pluralize(coded.length, "item")} with a code · ${formatNumber(Math.max(0, codable - coded.length))} without one yet`}
      fullWidth
      primaryAction={newCodes}
      secondaryActions={
        <>
          <Button icon={<Tags />} href={SHEET}>
            Other labels
          </Button>
          {coded.length > 0 && <Menu trigger={<IconButton aria-label="More actions" icon={<MoreHorizontal />} />} items={[{ label: "Export this view (CSV)", icon: <FileDown />, onSelect: () => exportCsv(rows), disabled: rows.length === 0 }]} />}
        </>
      }
    >
      {notice && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius)] border border-border bg-surface px-4 py-3 text-[13px] text-text">
          <span>
            <span className="font-medium">{notice.made === 1 ? "1 code saved." : `${formatNumber(notice.made)} codes saved.`}</span>{" "}
            {notice.replaced > 0 ? `${formatNumber(notice.replaced)} replaced an older code. ` : ""}
            {notice.made === 1 ? "It is" : "They are"} ticked below, ready to print.
          </span>
          <span className="flex items-center gap-2">
            <Button size="sm" variant="primary" icon={<Printer />} onClick={() => setDialog({ kind: "print", ids: Array.from(selectedIds) })} disabled={selectedIds.size === 0}>
              Print {selectedIds.size === 1 ? "it" : "them"}
            </Button>
            <Button size="sm" variant="plain" onClick={() => setNotice(null)}>
              Dismiss
            </Button>
          </span>
        </div>
      )}

      {coded.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={<QrCode />}
            title="No codes yet"
            description={writable ? "Make a barcode or QR code for your items, a step at a time. Each one is kept here to print, export, share or change, and pick lists print it beside the part." : "Nobody has made a code for an item in this workspace yet."}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button icon={<Tags />} href={SHEET}>
                  Other labels
                </Button>
                {newCodes}
              </div>
            }
          />
        </Card>
      ) : (
        <Table<CodedItem>
          rows={rows}
          columns={columns}
          rowKey={(i) => i.id}
          rowLabel={(i) => i.sku}
          onRowClick={(i) => setOpenId(i.id)}
          selectable
          selected={selectedIds}
          onSelectedChange={setSelected}
          pageSize={50}
          stateKey="codes"
          pageSizeKey="codes"
          lockHeader
          fit
          layoutKey="codes"
          defaultSort={{ key: "sku", dir: "asc" }}
          toolbar={toolbar}
          bulkActions={bulkActions}
          footer={`${pluralize(rows.length, "code")}${filtersActive ? ` of ${formatNumber(coded.length)}` : ""}`}
          emptyState={
            <EmptyState
              icon={<FilterX />}
              title="No codes match"
              description="Try a different search, or reset the filters to see every code."
              action={
                <Button icon={<FilterX />} onClick={clearFilters}>
                  Reset filters
                </Button>
              }
            />
          }
        />
      )}

      {opened && <CodeDrawer item={opened} writable={writable} onClose={() => setOpenId(null)} onPrint={() => setDialog({ kind: "print", ids: [opened.id] })} onEdit={() => setDialog({ kind: "edit", ids: [opened.id] })} onDelete={() => setDialog({ kind: "delete", ids: [opened.id] })} />}
      {dialog?.kind === "print" && dialogItems.length > 0 && <PrintCodesModal items={dialogItems} onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && dialogItems.length > 0 && <EditCodesModal items={dialogItems} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog?.kind === "delete" && dialogItems.length > 0}
        onClose={() => setDialog(null)}
        onConfirm={remove}
        loading={busy}
        destructive
        title={dialogItems.length === 1 ? `Delete the code for ${dialogItems[0]!.sku}?` : `Delete ${formatNumber(dialogItems.length)} codes?`}
        confirmLabel={dialogItems.length === 1 ? "Delete the code" : "Delete the codes"}
        message={
          <>
            {dialogItems.length === 1 ? "The item itself is not touched: only its saved code goes, and pick lists stop printing it." : `${sample} lose their saved code. The items themselves are not touched, and pick lists stop printing the codes.`} Labels already printed keep scanning. A new code can be made at any time.
          </>
        }
      />
    </Page>
  );
}
