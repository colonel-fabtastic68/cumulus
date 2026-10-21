"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, FolderOpen, Printer, Sparkles } from "lucide-react";
import { Badge, Banner, Button, Checkbox, Page, SearchField, Segmented, Select, Tabs, TextField, Toggle, useToast } from "@/components/ui";
import { useAgent } from "@/components/agent/AgentProvider";
import { useDocuments } from "@/lib/documents";
import { formatNumber, pluralize } from "@/lib/format";
import { entriesFor, type LabelData } from "@/lib/labels/entries";
import { buildLabelPdf } from "@/lib/labels/pdf";
import { layoutLabels, printCss, renderSvgs, sheetHtml, symbologyProblem } from "@/lib/labels/render";
import { DEFAULT_SPEC, LABEL_KINDS, SYMBOLOGIES, TEMPLATES, findTemplate, isTwoD, labelsPerPage, resolveTemplate, type LabelKind, type LabelSpec, type Symbology } from "@/lib/labels/spec";
import { openPrintWindow } from "@/lib/print";
import { useCollection, useItems, useSettings } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { cn, matches } from "@/lib/utils";

type Selection = "all" | Set<string>;

const PX_PER_IN = 96;

/** Reads the query the inventory list, the item page and Strato send: kind, skus or ids, template, symbology, encode. */
function ParamsReader({ onParams }: { onParams: (p: Record<string, string>) => void }) {
  const params = useSearchParams();
  const key = params.toString();
  useEffect(() => {
    if (!key) return;
    const out: Record<string, string> = {};
    params.forEach((v, k) => {
      out[k] = v;
    });
    onParams(out);
    const url = new URL(window.location.href);
    for (const k of Object.keys(out)) url.searchParams.delete(k);
    window.history.replaceState(null, "", url.pathname + url.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}

/**
 * Labels and barcodes for anything with a code: items (SKU or UPC),
 * assemblies, locations, suppliers and batches. Pick the stock, the code,
 * what to print beside it; preview the sheet; then print, download the PDF
 * or file it under Documents.
 */
export function LabelStudio() {
  const items = useItems();
  const locations = useCollection("locations");
  const suppliers = useCollection("suppliers");
  const lots = useCollection("lots");
  const settings = useSettings();
  const user = useCurrentUser();
  const docs = useDocuments();
  const toast = useToast();
  const { open: openAgent, setPageContext } = useAgent();
  const writable = canWrite(user);

  const [spec, setSpec] = useState<LabelSpec>(DEFAULT_SPEC);
  const [selection, setSelection] = useState<Selection>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [svgs, setSvgs] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<"print" | "pdf" | "save" | null>(null);
  // The page only renders once the workspace is open in the browser, so the origin is known on first render.
  const [origin] = useState(() => (typeof window !== "undefined" ? window.location.origin : ""));
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewWidth, setPreviewWidth] = useState(0);

  useEffect(() => {
    setPageContext({ page: "Labels & barcodes" });
  }, [setPageContext]);
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPreviewWidth(el.clientWidth));
    ro.observe(el);
    setPreviewWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const data = useMemo<LabelData>(() => ({ items, locations, suppliers, lots }), [items, locations, suppliers, lots]);
  const all = useMemo(() => entriesFor(spec.kind, data), [spec.kind, data]);

  const onParams = useCallback(
    (p: Record<string, string>) => {
      const kind = LABEL_KINDS.find((k) => k.id === p.kind)?.id ?? (p.skus ? "item" : undefined);
      const template = findTemplate(p.template);
      const symbology = SYMBOLOGIES.find((s) => s.id === p.symbology)?.id;
      setSpec((s) => ({ ...s, ...(kind ? { kind } : {}), ...(template ? { templateId: template.id } : {}), ...(symbology ? { symbology } : {}), ...(p.encode === "code" || p.encode === "link" ? { encode: p.encode } : {}) }));
      if (p.skus || p.ids) {
        const wantedCodes = new Set((p.skus ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean));
        const wantedIds = new Set((p.ids ?? "").split(",").map((x) => x.trim()).filter(Boolean));
        const k = kind ?? "item";
        const pool = entriesFor(k, data);
        setSelection(new Set(pool.filter((e) => wantedIds.has(e.id) || wantedCodes.has(e.code.toUpperCase()) || (e.gtin && wantedCodes.has(e.gtin))).map((e) => e.id)));
      }
    },
    [data],
  );

  const chosen = useMemo(() => (selection === "all" ? all : all.filter((e) => selection.has(e.id))), [all, selection]);
  const listed = useMemo(() => (query.trim() ? all.filter((e) => matches(query, e.title, e.code, e.subtitle, e.detail)) : all), [all, query]);
  const template = useMemo(() => resolveTemplate(spec), [spec]);
  const laid = useMemo(() => layoutLabels(spec, template, chosen, origin || "https://app.cumulusos.com"), [spec, template, chosen, origin]);
  const pages = laid.length ? Math.max(...laid.map((l) => l.page)) + 1 : 1;
  const shownPage = Math.min(page, pages - 1);
  const onPage = useMemo(() => laid.filter((l) => l.page === shownPage), [laid, shownPage]);

  // Codes on the shown page are drawn when the page or the spec changes; the rest only at print time.
  useEffect(() => {
    let stale = false;
    renderSvgs(onPage).then((m) => {
      if (!stale) setSvgs(m);
    });
    return () => {
      stale = true;
    };
  }, [onPage]);

  const sheet = useMemo(() => sheetHtml(spec, template, onPage.map((l) => ({ ...l, page: 0 })), svgs, settings.currency), [spec, template, onPage, svgs, settings.currency]);
  const scale = previewWidth ? Math.min(previewWidth / (template.pageW * PX_PER_IN), template.roll ? 2.5 : 1.2) : 1;

  const unencodable = useMemo(() => {
    if (spec.symbology !== "ean13" && spec.symbology !== "upca") return 0;
    return chosen.filter((e) => symbologyProblem(spec.symbology, e.gtin ?? e.code)).length;
  }, [chosen, spec.symbology]);

  const setField = (k: keyof LabelSpec["fields"], v: boolean) => setSpec((s) => ({ ...s, fields: { ...s.fields, [k]: v } }));
  const setCustom = (k: string, v: string) => setSpec((s) => ({ ...s, custom: { ...s.custom, [k]: Number(v) } }));
  const changeKind = (kind: LabelKind) => {
    setSpec((s) => ({ ...s, kind, fields: { ...s.fields, price: kind === "item" || kind === "assembly" ? s.fields.price : false } }));
    setSelection("all");
    setQuery("");
    setPage(0);
  };
  const toggleOne = (id: string) =>
    setSelection((sel) => {
      const next = new Set(sel === "all" ? all.map((e) => e.id) : sel);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const fileName = () => {
    const kind = LABEL_KINDS.find((k) => k.id === spec.kind)?.plural ?? "Labels";
    return `${kind} labels · ${template.name.replace(/\s*·.*$/, "")} · ${new Date().toISOString().slice(0, 10)}`;
  };

  const print = async () => {
    if (laid.length === 0) return;
    setBusy("print");
    try {
      const everySvg = await renderSvgs(laid);
      const full = sheetHtml(spec, template, laid, everySvg, settings.currency);
      const ok = openPrintWindow(fileName(), full.html, `${full.css}${printCss(template)}`);
      if (!ok) toast("Allow pop-ups to open the print view.", "critical");
    } finally {
      setBusy(null);
    }
  };

  const pdf = async (): Promise<{ bytes: Uint8Array; pages: number; labels: number }> => buildLabelPdf(spec, chosen, { origin: origin || "https://app.cumulusos.com", currency: settings.currency, title: fileName() });

  const download = async () => {
    if (laid.length === 0) return;
    setBusy("pdf");
    try {
      const out = await pdf();
      const url = URL.createObjectURL(new Blob([out.bytes as BlobPart], { type: "application/pdf" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName()}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast(`${pluralize(out.labels, "label")} on ${pluralize(out.pages, "page")}`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (laid.length === 0) return;
    setBusy("save");
    try {
      const out = await pdf();
      const name = `${fileName()}.pdf`;
      const file = new File([out.bytes as BlobPart], name, { type: "application/pdf" });
      const sym = SYMBOLOGIES.find((s) => s.id === spec.symbology)?.label ?? spec.symbology;
      await docs.upload({ file, name, folder: "Label sheets", kind: "document", description: `${pluralize(out.labels, "label")} · ${sym} · ${template.name} · ${pluralize(out.pages, "page")}` });
      toast(`Saved to Documents › Label sheets`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(null);
    }
  };

  const askStrato = () => {
    const kind = LABEL_KINDS.find((k) => k.id === spec.kind)?.plural.toLowerCase() ?? "items";
    openAgent(`Make me a label sheet for ${kind}: ${chosen.length === all.length ? "all of them" : `these ${chosen.length}`}, ${SYMBOLOGIES.find((s) => s.id === spec.symbology)?.label} on ${template.name}, and save it under Documents. Suggest which ones need labels most if the list is long.`, { send: false });
  };

  const twoD = isTwoD(spec.symbology);
  const retail = spec.symbology === "ean13" || spec.symbology === "upca";
  const kindMeta = LABEL_KINDS.find((k) => k.id === spec.kind)!;

  return (
    <Page
      title="Labels & barcodes"
      subtitle="QR codes and barcodes for items, assemblies, locations, suppliers and batches: print on label sheets or a roll, or file the PDF under Documents."
      fullWidth
      secondaryActions={
        <Button icon={<Sparkles />} onClick={askStrato}>
          Ask Strato
        </Button>
      }
      primaryAction={
        <Button variant="primary" icon={<Printer />} onClick={() => void print()} loading={busy === "print"} disabled={laid.length === 0 || busy !== null}>
          Print {laid.length ? formatNumber(laid.length) : ""}
        </Button>
      }
    >
      <Suspense fallback={null}>
        <ParamsReader onParams={onParams} />
      </Suspense>

      <Tabs value={spec.kind} onChange={changeKind} tabs={LABEL_KINDS.map((k) => ({ value: k.id, label: k.plural, count: entriesFor(k.id, data).length }))} />

      <div className="grid gap-4 @4xl:grid-cols-[300px_minmax(0,1fr)_300px]">
        {/* Which records */}
        <div className="card flex min-h-[320px] flex-col p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-[13.5px] font-semibold text-text">{kindMeta.plural}</h3>
            <div className="flex gap-2 text-[12px]">
              <button type="button" className="text-accent hover:underline" onClick={() => setSelection("all")}>
                All
              </button>
              <button type="button" className="text-accent hover:underline" onClick={() => setSelection(new Set())}>
                None
              </button>
            </div>
          </div>
          <p className="mb-2 text-[12px] text-text-tertiary">{kindMeta.hint}</p>
          <SearchField value={query} onChange={setQuery} placeholder={`Search ${kindMeta.plural.toLowerCase()}`} className="mb-2" />
          <ul className="-mx-1 flex max-h-[520px] min-h-0 flex-1 flex-col overflow-y-auto">
            {listed.slice(0, 500).map((e) => {
              const on = selection === "all" || selection.has(e.id);
              return (
                <li key={e.id}>
                  <label className={cn("flex cursor-pointer items-start gap-2 rounded-[var(--radius-sm)] px-1.5 py-1.5 hover:bg-surface-hover", on && "bg-surface-selected/60")}>
                    <Checkbox checked={on} onChange={() => toggleOne(e.id)} aria-label={e.title} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-text">{e.title}</span>
                      <span className="block truncate font-mono text-[11px] text-text-tertiary">
                        {e.code}
                        {e.gtin ? ` · ${e.gtin}` : ""}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
            {listed.length === 0 && <li className="px-1.5 py-6 text-center text-[12.5px] text-text-tertiary">Nothing here yet.</li>}
            {listed.length > 500 && <li className="px-1.5 py-2 text-[12px] text-text-tertiary">Showing 500 of {formatNumber(listed.length)}; search to narrow.</li>}
          </ul>
          <div className="mt-2 border-t border-border pt-2 text-[12px] text-text-secondary">
            {pluralize(chosen.length, "record")} · {pluralize(laid.length, "label")} · {pluralize(pages, "page")}
          </div>
        </div>

        {/* Preview */}
        <div className="flex min-w-0 flex-col gap-3">
          {unencodable > 0 && (
            <Banner tone="warning" title={`${pluralize(unencodable, "record")} without a valid ${spec.symbology === "ean13" ? "13-digit GTIN" : "12-digit UPC"}`}>
              Those labels print a Code 128 of the SKU instead. Add the barcode on the item to get a retail code.
            </Banner>
          )}
          <div className="card flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-[12.5px] text-text-secondary">
              {template.name} · {labelsPerPage(template)} per {template.roll ? "label" : "sheet"} · {template.labelW}×{template.labelH}&quot;
            </span>
            <div className="flex items-center gap-1 text-[12.5px]">
              <Button size="sm" variant="plain" icon={<ChevronLeft />} onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={shownPage === 0} aria-label="Previous page" />
              <span className="tabular text-text-secondary">
                {shownPage + 1} / {pages}
              </span>
              <Button size="sm" variant="plain" icon={<ChevronRight />} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={shownPage >= pages - 1} aria-label="Next page" />
            </div>
          </div>
          <div ref={previewRef} className="overflow-auto rounded-[var(--radius)] border border-border bg-[#e9e9e9] p-4">
            <style>{sheet.css}</style>
            <div style={{ width: template.pageW * PX_PER_IN * scale, height: template.pageH * PX_PER_IN * scale, margin: "0 auto" }}>
              <div className="shadow-[0_1px_4px_rgba(0,0,0,0.18)]" style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: template.pageW * PX_PER_IN, height: template.pageH * PX_PER_IN }} dangerouslySetInnerHTML={{ __html: sheet.html }} />
            </div>
          </div>
          {laid.length === 0 && <p className="text-center text-[12.5px] text-text-tertiary">Pick at least one record on the left.</p>}
        </div>

        {/* Options */}
        <div className="flex flex-col gap-4">
          <div className="card flex flex-col gap-3 p-4">
            <h3 className="text-[13.5px] font-semibold text-text">Label stock</h3>
            <Select label="Template" value={spec.templateId} onChange={(e) => setSpec((s) => ({ ...s, templateId: e.target.value }))} options={TEMPLATES.map((t) => ({ value: t.id, label: t.name }))} />
            <p className="-mt-1 text-[12px] text-text-tertiary">{TEMPLATES.find((t) => t.id === spec.templateId)?.description}</p>
            {spec.templateId === "custom" && (
              <div className="grid grid-cols-2 gap-2">
                <TextField label="Label width (in)" type="number" step="0.05" min="0.3" value={String(spec.custom?.labelW ?? template.labelW)} onChange={(e) => setCustom("labelW", e.target.value)} />
                <TextField label="Label height (in)" type="number" step="0.05" min="0.3" value={String(spec.custom?.labelH ?? template.labelH)} onChange={(e) => setCustom("labelH", e.target.value)} />
                <TextField label="Page width (in)" type="number" step="0.05" value={String(spec.custom?.pageW ?? template.pageW)} onChange={(e) => setCustom("pageW", e.target.value)} />
                <TextField label="Page height (in)" type="number" step="0.05" value={String(spec.custom?.pageH ?? template.pageH)} onChange={(e) => setCustom("pageH", e.target.value)} />
                <TextField label="Columns" type="number" min="1" value={String(spec.custom?.cols ?? template.cols)} onChange={(e) => setCustom("cols", e.target.value)} />
                <TextField label="Rows" type="number" min="1" value={String(spec.custom?.rows ?? template.rows)} onChange={(e) => setCustom("rows", e.target.value)} />
                <TextField label="Left margin (in)" type="number" step="0.05" value={String(spec.custom?.marginLeft ?? template.marginLeft)} onChange={(e) => setCustom("marginLeft", e.target.value)} />
                <TextField label="Top margin (in)" type="number" step="0.05" value={String(spec.custom?.marginTop ?? template.marginTop)} onChange={(e) => setCustom("marginTop", e.target.value)} />
                <TextField label="Gap across (in)" type="number" step="0.05" value={String(spec.custom?.gapX ?? template.gapX)} onChange={(e) => setCustom("gapX", e.target.value)} />
                <TextField label="Gap down (in)" type="number" step="0.05" value={String(spec.custom?.gapY ?? template.gapY)} onChange={(e) => setCustom("gapY", e.target.value)} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <TextField label="Copies each" type="number" min="1" max="200" value={String(spec.copies)} onChange={(e) => setSpec((s) => ({ ...s, copies: Math.max(1, Number(e.target.value) || 1) }))} />
              <TextField label="Skip on 1st sheet" type="number" min="0" value={String(spec.startAt)} onChange={(e) => setSpec((s) => ({ ...s, startAt: Math.max(0, Number(e.target.value) || 0) }))} hint="Used positions" />
            </div>
            <Toggle label="Outline each label" help="For plain paper, or to check alignment on a test print." checked={spec.border} onChange={(v) => setSpec((s) => ({ ...s, border: v }))} />
          </div>

          <div className="card flex flex-col gap-3 p-4">
            <h3 className="text-[13.5px] font-semibold text-text">Code</h3>
            <Select label="Symbology" value={spec.symbology} onChange={(e) => setSpec((s) => ({ ...s, symbology: e.target.value as Symbology }))} options={SYMBOLOGIES.map((s) => ({ value: s.id, label: s.label }))} />
            <p className="-mt-1 text-[12px] text-text-tertiary">{SYMBOLOGIES.find((s) => s.id === spec.symbology)?.hint}</p>
            {!retail && (
              <div>
                <div className="mb-1 text-[12.5px] font-medium text-text">The code carries</div>
                <Segmented<LabelSpec["encode"]> value={spec.encode} onChange={(v) => setSpec((s) => ({ ...s, encode: v }))} options={[{ value: "link", label: "Link to cumulusOS" }, { value: "code", label: twoD ? "Plain code" : "The code" }]} />
                <p className="mt-1 text-[12px] text-text-tertiary">{spec.encode === "link" ? "A phone camera opens the record; the in-app scanner reads it too." : "Just the SKU, location code or lot number; works with any scanner or system."}</p>
              </div>
            )}
          </div>

          <div className="card flex flex-col gap-2 p-4">
            <h3 className="text-[13.5px] font-semibold text-text">Printed beside the code</h3>
            <Checkbox label="Name" checked={spec.fields.name} onChange={(v) => setField("name", v)} />
            <Checkbox label={spec.kind === "lot" ? "Lot number" : spec.kind === "location" ? "Location code" : "SKU / code"} checked={spec.fields.code} onChange={(v) => setField("code", v)} />
            <Checkbox label="Details" help={spec.kind === "item" || spec.kind === "assembly" ? "Category and bin" : spec.kind === "lot" ? "SKU, supplier lot, expiry" : spec.kind === "location" ? "Kind of location" : "Phone or email"} checked={spec.fields.detail} onChange={(v) => setField("detail", v)} />
            {(spec.kind === "item" || spec.kind === "assembly") && <Checkbox label="Price" checked={spec.fields.price} onChange={(v) => setField("price", v)} />}
            <div className="mt-1">
              <div className="mb-1 text-[12.5px] font-medium text-text">Text size</div>
              <Segmented<string> value={String(spec.textScale)} onChange={(v) => setSpec((s) => ({ ...s, textScale: Number(v) }))} options={[{ value: "0.8", label: "S" }, { value: "1", label: "M" }, { value: "1.25", label: "L" }]} />
            </div>
          </div>

          <div className="card flex flex-col gap-2 p-4">
            <Button variant="primary" icon={<Printer />} onClick={() => void print()} loading={busy === "print"} disabled={laid.length === 0 || busy !== null} fullWidth>
              Print
            </Button>
            <Button icon={<Download />} onClick={() => void download()} loading={busy === "pdf"} disabled={laid.length === 0 || busy !== null} fullWidth>
              Download PDF
            </Button>
            <Button icon={<FolderOpen />} onClick={() => void save()} loading={busy === "save"} disabled={laid.length === 0 || busy !== null || !writable} fullWidth>
              Save to Documents
            </Button>
            <p className="text-[11.5px] text-text-tertiary">
              Saved sheets land in Documents under <Badge>Label sheets</Badge>. Print scales nothing: set the printer to 100% / actual size.
            </p>
          </div>
        </div>
      </div>
    </Page>
  );
}
