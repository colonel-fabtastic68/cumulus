import type { Item } from "@/lib/types";
import { downloadBlob, stamp } from "@/lib/export/formats";
import { buildLabelPdf } from "@/lib/labels/pdf";
import { barcodePng, barcodeSvg } from "@/lib/labels/render";
import { templateById } from "@/lib/labels/spec";
import type { CsvCell } from "@/components/reports/csv";
import { carriesLabel, codeDrawing, printedBeside, sheetFor, symbologyLabel, type CodeChoice, type CodedItem, type SheetOptions } from "@/lib/savedCodes";

/** Files made from saved codes in the browser: one code as an image, many as a label sheet, the list as CSV. */

const safeName = (s: string) => s.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "code";

/** The code alone as a PNG on white with clear space around it, ready to drop into artwork or a message. */
export async function codePng(item: Item, code: CodeChoice, origin: string): Promise<File> {
  const { text, symbology } = codeDrawing(item, code, origin);
  const img = new Image();
  img.src = await barcodePng(symbology, text);
  await img.decode();
  const pad = Math.round(Math.max(img.width, img.height) * 0.08);
  const canvas = document.createElement("canvas");
  canvas.width = img.width + pad * 2;
  canvas.height = img.height + pad * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not draw the image");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, pad, pad);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("This browser could not make the image");
  return new File([blob], `${safeName(item.sku)}.png`, { type: "image/png" });
}

/** The code alone as an SVG: sharp at any size, for packaging and print artwork. */
export async function codeSvg(item: Item, code: CodeChoice, origin: string): Promise<File> {
  const { text, symbology } = codeDrawing(item, code, origin);
  const svg = await barcodeSvg(symbology, text);
  const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const sized = svg.replace(/ style="[^"]*"/, box ? ` width="${Number(box[1]) * 2}" height="${Number(box[2]) * 2}"` : "");
  return new File([`<?xml version="1.0" encoding="UTF-8"?>\n${sized}`], `${safeName(item.sku)}.svg`, { type: "image/svg+xml" });
}

export function sheetTitle(items: CodedItem[], sheet: SheetOptions): string {
  const what = items.length === 1 ? items[0]!.sku : `${items.length} codes`;
  return `Labels · ${what} · ${templateById(sheet.templateId).name.replace(/\s*·.*$/, "")} · ${stamp()}`;
}

/** The label sheet as a PDF, each item with its own saved code. */
export async function sheetPdf(items: CodedItem[], sheet: SheetOptions, ctx: { origin: string; currency: string; supplierName?: (id: string) => string | undefined }): Promise<{ file: File; pages: number; labels: number }> {
  const { spec, entries } = sheetFor(items, sheet, ctx.supplierName);
  const title = sheetTitle(items, sheet);
  const out = await buildLabelPdf(spec, entries, { origin: ctx.origin, currency: ctx.currency, title });
  return { file: new File([out.bytes as BlobPart], `${title}.pdf`, { type: "application/pdf" }), pages: out.pages, labels: out.labels };
}

/** Hands the file to the device's share sheet (mail, messages, AirDrop); where the browser has none, downloads it. */
export async function shareOrDownload(file: File, title: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === "function" && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return "shared";
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return "cancelled";
      // Not allowed here (the share sheet needs a fresh click): fall through to a download.
    }
  }
  downloadBlob(file.name, file);
  return "downloaded";
}

/** The list of codes as CSV rows: what each one is and what it reads as. */
export function codesCsv(items: CodedItem[], origin: string, terms: { itemCode: string; itemCodeShort: string }): { headers: string[]; rows: CsvCell[][] } {
  return {
    headers: [terms.itemCode, "Name", "Kind of code", "Carries", "Reads as", "Printed beside", "Category", "Bin", "Made"],
    rows: items.map((i) => {
      const { text, symbology } = codeDrawing(i, i.savedCode, origin);
      return [i.sku, i.name, symbologyLabel(symbology), carriesLabel(i.savedCode, terms.itemCodeShort), text, printedBeside(i.savedCode, terms.itemCodeShort), i.category ?? "", i.location ?? "", i.savedCode.createdAt.slice(0, 10)];
    }),
  };
}
