import { escapeHtml } from "@/lib/print";
import { formatMoney } from "@/lib/format";
import { encodedText, type LabelEntry } from "./entries";
import { isTwoD, labelsPerPage, type LabelSpec, type LabelTemplate, type Symbology } from "./spec";

/**
 * Barcode drawing (bwip-js, loaded on first use) and the sheet layout shared
 * by the on-screen preview and the print view. The PDF builder mirrors the
 * same geometry in points.
 */

type Bwip = typeof import("bwip-js/browser");
let bwipPromise: Promise<Bwip> | null = null;
function bwip(): Promise<Bwip> {
  bwipPromise ??= import("bwip-js/browser");
  return bwipPromise;
}

/** Why a symbology cannot carry this text, or null when it can. */
export function symbologyProblem(symbology: Symbology, text: string): string | null {
  switch (symbology) {
    case "ean13":
      return /^\d{12,13}$/.test(text) ? null : "EAN-13 needs a 12- or 13-digit GTIN";
    case "upca":
      return /^\d{11,12}$/.test(text) ? null : "UPC-A needs an 11- or 12-digit UPC";
    case "code39":
      return /^[0-9A-Z\-. $/+%]+$/.test(text) ? null : "Code 39 takes upper-case letters, digits and - . $ / + %";
    case "code128":
      return /^[\x20-\x7e]+$/.test(text) ? null : "Code 128 takes plain ASCII";
    default:
      return text.length > 0 ? null : "Nothing to encode";
  }
}

/** The symbology actually drawn: Code 128 stands in when the chosen one cannot carry the text. */
export function effectiveSymbology(symbology: Symbology, text: string): Symbology {
  if (!symbologyProblem(symbology, text)) return symbology;
  if (symbology === "code39" && /^[\x20-\x7e]+$/.test(text)) return "code128";
  return isTwoD(symbology) ? symbology : "code128";
}

const BCID: Record<Symbology, string> = { qrcode: "qrcode", datamatrix: "datamatrix", code128: "code128", code39: "code39", ean13: "ean13", upca: "upca" };

/** An SVG of the code, sized by its container (width/height attributes removed, viewBox kept). */
export async function barcodeSvg(symbology: Symbology, text: string): Promise<string> {
  const lib = await bwip();
  const sym = effectiveSymbology(symbology, text);
  const svg = lib.toSVG({ bcid: BCID[sym], text, scale: 2, includetext: false, ...(isTwoD(sym) ? {} : { height: 10 }), ...(sym === "qrcode" ? { eclevel: "M" } : {}) });
  return svg.replace(/^<svg([^>]*?)\swidth="[^"]*"/, "<svg$1").replace(/^<svg([^>]*?)\sheight="[^"]*"/, "<svg$1").replace(/^<svg/, '<svg preserveAspectRatio="xMidYMid meet" style="width:100%;height:100%;display:block"');
}

/** A PNG data URL of the code for the PDF, drawn large so it stays crisp when scaled down. */
export async function barcodePng(symbology: Symbology, text: string): Promise<string> {
  const lib = await bwip();
  const sym = effectiveSymbology(symbology, text);
  const canvas = document.createElement("canvas");
  lib.toCanvas(canvas, { bcid: BCID[sym], text, scale: isTwoD(sym) ? 8 : 4, includetext: false, ...(isTwoD(sym) ? {} : { height: 12 }), ...(sym === "qrcode" ? { eclevel: "M" } : {}) });
  return canvas.toDataURL("image/png");
}

export interface LaidOutLabel {
  entry: LabelEntry;
  text: string;
  symbology: Symbology;
  page: number;
  col: number;
  row: number;
  /** Position within the page, inches from the top-left of the page. */
  x: number;
  y: number;
}

/** Copies, the first-sheet offset and the grid turn entries into positioned labels. */
export function layoutLabels(spec: LabelSpec, template: LabelTemplate, entries: LabelEntry[], origin: string): LaidOutLabel[] {
  const per = labelsPerPage(template);
  const out: LaidOutLabel[] = [];
  let slot = Math.max(0, Math.min(per - 1, Math.floor(spec.startAt)));
  const copies = Math.max(1, Math.min(200, Math.floor(spec.copies)));
  for (const entry of entries) {
    const text = encodedText(entry, spec.encode, spec.symbology, origin);
    const symbology = effectiveSymbology(spec.symbology, text);
    for (let c = 0; c < copies; c++) {
      const page = Math.floor(slot / per);
      const i = slot % per;
      const col = i % template.cols;
      const row = Math.floor(i / template.cols);
      out.push({ entry, text, symbology, page, col, row, x: template.marginLeft + col * (template.labelW + template.gapX), y: template.marginTop + row * (template.labelH + template.gapY) });
      slot++;
    }
  }
  return out;
}

/** Point size for the main line, from the label height; the rest step down from it. */
export function baseFontPt(template: LabelTemplate, textScale: number): number {
  return Math.max(5, Math.min(13, template.labelH * 8)) * textScale;
}

export interface SheetHtml {
  html: string;
  css: string;
  pages: number;
}

/**
 * The sheet as HTML: one absolutely positioned page per sheet, labels placed
 * by the template, codes as inline SVG. The preview scales it; the print
 * view sets @page to the paper size so nothing is re-flowed.
 */
export function sheetHtml(spec: LabelSpec, template: LabelTemplate, laid: LaidOutLabel[], svgs: Map<string, string>, currency: string): SheetHtml {
  const pages = laid.length ? Math.max(...laid.map((l) => l.page)) + 1 : 1;
  const pt = baseFontPt(template, spec.textScale);
  const pad = Math.min(0.08, template.labelH * 0.08);
  const twoD = isTwoD(spec.symbology);
  const css = `
.sheet-page{position:relative;width:${template.pageW}in;height:${template.pageH}in;background:#fff;overflow:hidden;page-break-after:always;break-after:page}
.sheet-page:last-child{page-break-after:auto;break-after:auto}
.lbl{position:absolute;width:${template.labelW}in;height:${template.labelH}in;box-sizing:border-box;padding:${pad}in;display:flex;gap:${pad}in;overflow:hidden;color:#111;font-family:-apple-system,Inter,"Segoe UI",Helvetica,Arial,sans-serif;${spec.border ? "outline:0.5px solid #bbb;outline-offset:-0.5px;" : ""}}
.lbl.twoD{flex-direction:row;align-items:center}
.lbl.twoD .code{flex:0 0 auto;height:100%;aspect-ratio:1/1;max-width:48%}
.lbl.twoD .txt{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:${(pt * 0.15).toFixed(2)}pt}
.lbl.oneD{flex-direction:column;align-items:stretch}
.lbl.oneD .code{flex:1 1 auto;min-height:0;width:100%}
.lbl.oneD .txt{flex:0 0 auto;display:flex;flex-direction:column;align-items:center;text-align:center;gap:${(pt * 0.1).toFixed(2)}pt}
.lbl .code svg{width:100%;height:100%;display:block}
.t1{font-size:${pt.toFixed(2)}pt;font-weight:600;line-height:1.15;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;word-break:break-word}
.t2{font-size:${(pt * 0.8).toFixed(2)}pt;line-height:1.15;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.t3{font-size:${(pt * 0.72).toFixed(2)}pt;line-height:1.15;color:#444;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.t4{font-size:${(pt * 0.95).toFixed(2)}pt;line-height:1.15;font-weight:600}
`;
  const byPage: string[][] = Array.from({ length: pages }, () => []);
  for (const l of laid) {
    const key = `${l.symbology}|${l.text}`;
    const svg = svgs.get(key) ?? "";
    const e = l.entry;
    const lines: string[] = [];
    if (spec.fields.name) lines.push(`<div class="t1">${escapeHtml(e.title)}</div>`);
    if (spec.fields.code) lines.push(`<div class="t2">${escapeHtml(e.subtitle ?? e.code)}</div>`);
    if (spec.fields.detail && e.detail) lines.push(`<div class="t3">${escapeHtml(e.detail)}</div>`);
    if (spec.fields.price && e.price !== undefined) lines.push(`<div class="t4">${escapeHtml(formatMoney(e.price, currency))}</div>`);
    byPage[l.page]!.push(`<div class="lbl ${twoD ? "twoD" : "oneD"}" style="left:${l.x}in;top:${l.y}in"><div class="code" title="${escapeHtml(l.text)}">${svg}</div>${lines.length ? `<div class="txt">${lines.join("")}</div>` : ""}</div>`);
  }
  const html = byPage.map((labels) => `<div class="sheet-page">${labels.join("")}</div>`).join("");
  return { html, css, pages };
}

/** Draws every distinct code once. */
export async function renderSvgs(laid: LaidOutLabel[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const l of laid) {
    const key = `${l.symbology}|${l.text}`;
    if (out.has(key)) continue;
    try {
      out.set(key, await barcodeSvg(l.symbology, l.text));
    } catch {
      out.set(key, `<svg viewBox="0 0 10 10"><text x="0" y="7" font-size="3" fill="#b00">?</text></svg>`);
    }
  }
  return out;
}

/** CSS for the print window: the paper is the template's page, no margins, and the pages stack. */
export function printCss(template: LabelTemplate): string {
  return `@page{size:${template.pageW}in ${template.pageH}in;margin:0}html,body{margin:0;padding:0;background:#fff}`;
}
