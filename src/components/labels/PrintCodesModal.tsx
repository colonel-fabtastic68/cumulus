"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FolderOpen, Printer, Share2 } from "lucide-react";
import { Button, Modal, Select, TextField, Toggle, useToast } from "@/components/ui";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useDocuments } from "@/lib/documents";
import { downloadBlob } from "@/lib/export/formats";
import { formatNumber, pluralize } from "@/lib/format";
import { layoutLabels, printCss, renderSvgs, sheetHtml } from "@/lib/labels/render";
import { TEMPLATES, labelsPerPage, resolveTemplate, templateById } from "@/lib/labels/spec";
import { openPrintWindowWhenReady } from "@/lib/print";
import { sheetFor, type CodedItem, type SheetOptions } from "@/lib/savedCodes";
import { useCollection, useSettings } from "@/lib/store/provider";
import { useOrigin } from "./CodeArt";
import { shareOrDownload, sheetPdf, sheetTitle } from "./codeFiles";

const PX_PER_IN = 96;
const PREVIEW_PX = 430;
const SHEET_KEY = "cumulus.codes.sheet";
/** Stock that needs no measuring: the custom size stays in the sheet designer. */
const STOCK = TEMPLATES.filter((t) => t.id !== "custom");

/** The stock used last in this browser, with one copy each and nothing skipped. */
export function rememberedSheet(): SheetOptions {
  let saved: Partial<SheetOptions> = {};
  try {
    saved = JSON.parse(window.localStorage.getItem(SHEET_KEY) ?? "{}") as Partial<SheetOptions>;
  } catch {
    // Storage blocked or unreadable: start from the defaults.
  }
  const templateId = STOCK.some((t) => t.id === saved.templateId) ? saved.templateId! : templateById(undefined).id;
  return { templateId, copies: 1, startAt: 0, border: saved.border === true };
}

type Busy = "print" | "pdf" | "save" | "share" | null;

/**
 * Saved codes onto label stock: choose the sheet or roll, how many of each and where a part-used sheet
 * starts, look at the result, then print it, download or share the PDF, or file it under Documents.
 * Each item prints its own saved code, so one sheet can mix QR codes and bars.
 */
export function PrintCodesModal({ items, onClose }: { items: CodedItem[]; onClose: () => void }) {
  const settings = useSettings();
  const toast = useToast();
  const docs = useDocuments();
  const writable = canWrite(useCurrentUser());
  const suppliers = useCollection("suppliers");
  const origin = useOrigin();
  const [sheet, setSheet] = useState<SheetOptions>(rememberedSheet);
  const [page, setPage] = useState(0);
  const [svgs, setSvgs] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<Busy>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(SHEET_KEY, JSON.stringify({ templateId: sheet.templateId, border: sheet.border }));
    } catch {
      // Not remembered, nothing else changes.
    }
  }, [sheet.templateId, sheet.border]);

  const supplierName = useMemo(() => {
    const names = new Map(suppliers.map((s) => [s.id, s.name]));
    return (id: string) => names.get(id);
  }, [suppliers]);
  const { spec, entries } = useMemo(() => sheetFor(items, sheet, supplierName), [items, sheet, supplierName]);
  const template = useMemo(() => resolveTemplate(spec), [spec]);
  const laid = useMemo(() => layoutLabels(spec, template, entries, origin), [spec, template, entries, origin]);
  const pages = laid.length ? Math.max(...laid.map((l) => l.page)) + 1 : 1;
  const shownPage = Math.min(page, pages - 1);
  const onPage = useMemo(() => laid.filter((l) => l.page === shownPage), [laid, shownPage]);

  // Only the page on screen is drawn here; the rest are drawn when printing.
  useEffect(() => {
    let stale = false;
    renderSvgs(onPage).then((m) => {
      if (!stale) setSvgs(m);
    });
    return () => {
      stale = true;
    };
  }, [onPage]);

  const preview = useMemo(() => sheetHtml(spec, template, onPage.map((l) => ({ ...l, page: 0 })), svgs, settings.currency), [spec, template, onPage, svgs, settings.currency]);
  const scale = Math.min(PREVIEW_PX / (template.pageW * PX_PER_IN), template.roll ? 2 : 1);
  const title = sheetTitle(items, sheet);
  const ctx = { origin, currency: settings.currency, supplierName };

  const print = () => {
    if (laid.length === 0) return;
    // The window opens inside this click; the codes for every page are drawn into it a moment later.
    const body = renderSvgs(laid).then((every) => sheetHtml(spec, template, laid, every, settings.currency).html);
    if (!openPrintWindowWhenReady(title, body, `${preview.css}${printCss(template)}`)) toast("Allow pop-ups to open the print view.", "critical");
  };

  const run = async (what: Exclude<Busy, "print" | null>) => {
    if (laid.length === 0) return;
    setBusy(what);
    try {
      const out = await sheetPdf(items, sheet, ctx);
      const summary = `${pluralize(out.labels, "label")} on ${pluralize(out.pages, "page")}`;
      if (what === "pdf") {
        downloadBlob(out.file.name, out.file);
        toast(`Downloaded ${summary}`, "success");
      } else if (what === "save") {
        await docs.upload({ file: out.file, name: out.file.name, folder: "Label sheets", kind: "document", description: `${summary} · ${template.name}` });
        toast("Saved to Documents › Label sheets", "success");
      } else {
        const result = await shareOrDownload(out.file, title);
        if (result === "downloaded") toast("This browser has no share sheet, so the PDF was downloaded instead", "success");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={items.length === 1 ? `Print ${items[0]!.sku}` : `Print ${formatNumber(items.length)} codes`}
      subtitle="Each item prints its own saved code. Set the printer to 100% or actual size: nothing is scaled."
      footer={
        <>
          <div className="mr-auto flex flex-wrap items-center gap-1">
            <Button variant="plain" icon={<FolderOpen />} onClick={() => void run("save")} loading={busy === "save"} disabled={busy !== null || !writable}>
              Save to Documents
            </Button>
            <Button variant="plain" icon={<Share2 />} onClick={() => void run("share")} loading={busy === "share"} disabled={busy !== null}>
              Share
            </Button>
          </div>
          <Button icon={<Download />} onClick={() => void run("pdf")} loading={busy === "pdf"} disabled={busy !== null}>
            Download PDF
          </Button>
          <Button variant="primary" icon={<Printer />} onClick={print} disabled={busy !== null || laid.length === 0}>
            Print {formatNumber(laid.length)}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[260px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <Select label="Label stock" value={sheet.templateId} onChange={(e) => { setSheet((s) => ({ ...s, templateId: e.target.value })); setPage(0); }} options={STOCK.map((t) => ({ value: t.id, label: t.name }))} />
          <p className="-mt-1 text-[12px] text-text-tertiary">{template.description}</p>
          <div className="grid grid-cols-2 gap-2">
            <TextField label="Copies each" type="number" min="1" max="200" value={String(sheet.copies)} onChange={(e) => setSheet((s) => ({ ...s, copies: Math.max(1, Math.min(200, Number(e.target.value) || 1)) }))} />
            {!template.roll && <TextField label="Skip labels" type="number" min="0" value={String(sheet.startAt)} onChange={(e) => setSheet((s) => ({ ...s, startAt: Math.max(0, Number(e.target.value) || 0) }))} />}
          </div>
          {!template.roll && <p className="-mt-1 text-[12px] text-text-tertiary">Skip the positions already used on a part-used first sheet.</p>}
          <Toggle label="Outline each label" help="For plain paper, or to check alignment on a test print." checked={sheet.border} onChange={(v) => setSheet((s) => ({ ...s, border: v }))} />
          <p className="text-[12px] text-text-tertiary">
            {pluralize(laid.length, "label")} on {pluralize(pages, template.roll ? "label" : "sheet")} · {labelsPerPage(template)} per {template.roll ? "label" : "sheet"} · {template.labelW}×{template.labelH}&quot;
          </p>
        </div>
        <div className="min-w-0">
          <div className="mb-2 flex items-center justify-between gap-2 text-[12.5px] text-text-secondary">
            <span>{template.name}</span>
            <span className="flex items-center gap-1">
              <Button size="sm" variant="plain" icon={<ChevronLeft />} onClick={() => setPage(Math.max(0, shownPage - 1))} disabled={shownPage === 0} aria-label="Previous page" />
              <span className="tabular">
                {shownPage + 1} / {pages}
              </span>
              <Button size="sm" variant="plain" icon={<ChevronRight />} onClick={() => setPage(Math.min(pages - 1, shownPage + 1))} disabled={shownPage >= pages - 1} aria-label="Next page" />
            </span>
          </div>
          <div className="max-h-[56vh] overflow-auto rounded-[var(--radius)] border border-border bg-[#e9e9e9] p-4">
            <style>{preview.css}</style>
            <div style={{ width: template.pageW * PX_PER_IN * scale, height: template.pageH * PX_PER_IN * scale, margin: "0 auto" }}>
              <div className="shadow-[0_1px_4px_rgba(0,0,0,0.18)]" style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: template.pageW * PX_PER_IN, height: template.pageH * PX_PER_IN }} dangerouslySetInnerHTML={{ __html: preview.html }} />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
