import { formatMoney } from "@/lib/format";
import { barcodePng, baseFontPt, layoutLabels, type LaidOutLabel } from "./render";
import type { LabelEntry } from "./entries";
import { isTwoD, resolveTemplate, type LabelSpec, type LabelTemplate } from "./spec";

const PT = 72;

/**
 * The sheet as a PDF (pdf-lib, loaded on first use): the same geometry as the
 * HTML sheet, codes embedded as PNGs drawn large, text in Helvetica. Built in
 * the browser, so Strato can file it under Documents without a server.
 */
export async function buildLabelPdf(spec: LabelSpec, entries: LabelEntry[], opts: { origin: string; currency: string; title?: string }): Promise<{ bytes: Uint8Array; pages: number; labels: number }> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const template = resolveTemplate(spec);
  const laid = layoutLabels(spec, template, entries, opts.origin);
  const pageCount = laid.length ? Math.max(...laid.map((l) => l.page)) + 1 : 1;

  const doc = await PDFDocument.create();
  doc.setTitle(opts.title ?? "Labels");
  doc.setProducer("cumulusOS");
  doc.setCreator("cumulusOS");
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  const images = new Map<string, Awaited<ReturnType<typeof doc.embedPng>>>();
  for (const l of laid) {
    const key = `${l.symbology}|${l.text}`;
    if (images.has(key)) continue;
    try {
      images.set(key, await doc.embedPng(await barcodePng(l.symbology, l.text)));
    } catch {
      // Unencodable text: the label prints its text without a code.
    }
  }

  const pages = Array.from({ length: pageCount }, () => doc.addPage([template.pageW * PT, template.pageH * PT]));
  const pt = baseFontPt(template, spec.textScale);
  const pad = Math.min(0.08, template.labelH * 0.08) * PT;
  const twoD = isTwoD(spec.symbology);
  const grey = rgb(0.27, 0.27, 0.27);
  const black = rgb(0.07, 0.07, 0.07);

  const fit = (text: string, font: typeof sans, size: number, width: number): string => {
    if (font.widthOfTextAtSize(text, size) <= width) return text;
    let s = text;
    while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > width) s = s.slice(0, -1);
    return `${s}…`;
  };
  const wrap2 = (text: string, font: typeof sans, size: number, width: number): string[] => {
    if (font.widthOfTextAtSize(text, size) <= width) return [text];
    const words = text.split(/\s+/);
    let first = "";
    for (const w of words) {
      const next = first ? `${first} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > width) break;
      first = next;
    }
    if (!first) first = fit(text, font, size, width);
    const rest = text.slice(first.length).trim();
    return rest ? [first, fit(rest, font, size, width)] : [first];
  };

  for (const l of laid) {
    const page = pages[l.page]!;
    const W = template.labelW * PT;
    const H = template.labelH * PT;
    const left = l.x * PT;
    const top = template.pageH * PT - l.y * PT;
    if (spec.border) page.drawRectangle({ x: left + 0.25, y: top - H + 0.25, width: W - 0.5, height: H - 0.5, borderWidth: 0.5, borderColor: rgb(0.73, 0.73, 0.73) });
    const img = images.get(`${l.symbology}|${l.text}`);
    const e = l.entry;
    const lines = textLines(spec, e, opts.currency);
    const hasText = lines.length > 0;

    if (twoD) {
      const side = Math.min(H - 2 * pad, hasText ? (W - 2 * pad) * 0.48 : W - 2 * pad);
      const imgX = hasText ? left + pad : left + (W - side) / 2;
      if (img) page.drawImage(img, { x: imgX, y: top - pad - (H - 2 * pad + side) / 2, width: side, height: side });
      if (hasText) drawLines(page, lines, { x: left + pad + side + pad, width: W - 3 * pad - side, centerY: top - H / 2, align: "left" });
    } else {
      const textH = lines.reduce((a, ln) => a + ln.size * 1.2, 0);
      const barsH = Math.max(H * 0.3, H - 2 * pad - textH - (hasText ? pad * 0.5 : 0));
      const barsW = W - 2 * pad;
      if (img) {
        // Bars keep their drawn proportions no wider than the label; tall labels leave air above and below.
        const ratio = img.width / img.height;
        const w = Math.min(barsW, barsH * ratio);
        const h = w / ratio;
        page.drawImage(img, { x: left + (W - w) / 2, y: top - pad - barsH + (barsH - h) / 2, width: w, height: h });
      }
      if (hasText) drawLines(page, lines, { x: left + pad, width: barsW, topY: top - pad - barsH - pad * 0.5, align: "center" });
    }
  }

  function textLines(s: LabelSpec, e: LabelEntry, currency: string): Array<{ text: string; font: typeof sans; size: number; color: typeof grey; wrap?: boolean }> {
    const out: Array<{ text: string; font: typeof sans; size: number; color: typeof grey; wrap?: boolean }> = [];
    if (s.fields.name) out.push({ text: e.title, font: bold, size: pt, color: black, wrap: true });
    if (s.fields.code) out.push({ text: e.subtitle ?? e.code, font: mono, size: pt * 0.8, color: black });
    if (s.fields.detail && e.detail) out.push({ text: e.detail, font: sans, size: pt * 0.72, color: grey });
    if (s.fields.price && e.price !== undefined) out.push({ text: formatMoney(e.price, currency), font: bold, size: pt * 0.95, color: black });
    return out;
  }

  function drawLines(page: (typeof pages)[number], lines: ReturnType<typeof textLines>, box: { x: number; width: number; centerY?: number; topY?: number; align: "left" | "center" }) {
    const rows: Array<{ text: string; font: typeof sans; size: number; color: typeof grey }> = [];
    for (const ln of lines) {
      const parts = ln.wrap ? wrap2(ln.text, ln.font, ln.size, box.width) : [fit(ln.text, ln.font, ln.size, box.width)];
      for (const p of parts) rows.push({ ...ln, text: p });
    }
    const total = rows.reduce((a, r) => a + r.size * 1.2, 0);
    let y = box.topY !== undefined ? box.topY : box.centerY! + total / 2;
    for (const r of rows) {
      y -= r.size;
      const w = r.font.widthOfTextAtSize(r.text, r.size);
      const x = box.align === "center" ? box.x + (box.width - w) / 2 : box.x;
      page.drawText(r.text, { x, y, size: r.size, font: r.font, color: r.color });
      y -= r.size * 0.2;
    }
  }

  return { bytes: await doc.save(), pages: pageCount, labels: laid.length };
}

export type { LaidOutLabel, LabelTemplate };
