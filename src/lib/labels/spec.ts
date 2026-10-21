/**
 * Labels and barcodes: what gets printed, on which stock, with which code.
 * Sizes are inches (label stock is sold that way); 72 points per inch in the PDF.
 */

export type LabelKind = "item" | "assembly" | "location" | "supplier" | "lot";

export const LABEL_KINDS: Array<{ id: LabelKind; label: string; plural: string; hint: string }> = [
  { id: "item", label: "Item", plural: "Items", hint: "SKU or the item's own barcode (UPC / PLU)" },
  { id: "assembly", label: "Assembly", plural: "Assemblies", hint: "Finished builds and kits with a BOM" },
  { id: "location", label: "Location", plural: "Locations", hint: "Warehouses, stores, trucks: the location code" },
  { id: "supplier", label: "Supplier", plural: "Suppliers", hint: "For receiving bays and supplier bins" },
  { id: "lot", label: "Batch", plural: "Batches", hint: "Lot numbers (LOT-1001) still on the shelf" },
];

export type Symbology = "qrcode" | "datamatrix" | "code128" | "code39" | "ean13" | "upca";
export type EncodeMode = "code" | "link";

export const SYMBOLOGIES: Array<{ id: Symbology; label: string; hint: string; twoD: boolean }> = [
  { id: "qrcode", label: "QR code", hint: "Any phone camera reads it; can open the record in cumulusOS", twoD: true },
  { id: "datamatrix", label: "Data Matrix", hint: "Tiny square code for small parts and tags", twoD: true },
  { id: "code128", label: "Code 128", hint: "The standard barcode for SKUs, bins and batches", twoD: false },
  { id: "code39", label: "Code 39", hint: "Older scanners; upper-case letters, digits and - . /", twoD: false },
  { id: "ean13", label: "EAN-13", hint: "Retail barcode, 13 digits; needs a GTIN on the item", twoD: false },
  { id: "upca", label: "UPC-A", hint: "North-American retail barcode, 12 digits; needs a UPC on the item", twoD: false },
];

export function isTwoD(s: Symbology): boolean {
  return SYMBOLOGIES.find((x) => x.id === s)?.twoD ?? false;
}

export interface LabelTemplate {
  id: string;
  name: string;
  description: string;
  /** Page size in inches; a roll label's page is the label itself. */
  pageW: number;
  pageH: number;
  labelW: number;
  labelH: number;
  cols: number;
  rows: number;
  marginLeft: number;
  marginTop: number;
  gapX: number;
  gapY: number;
  roll?: boolean;
}

export const TEMPLATES: LabelTemplate[] = [
  { id: "avery5160", name: "Avery 5160 · 30 per sheet", description: '2⅝ × 1" address labels, letter paper', pageW: 8.5, pageH: 11, labelW: 2.625, labelH: 1, cols: 3, rows: 10, marginLeft: 0.1875, marginTop: 0.5, gapX: 0.125, gapY: 0 },
  { id: "avery5163", name: "Avery 5163 · 10 per sheet", description: '4 × 2" shipping labels, letter paper', pageW: 8.5, pageH: 11, labelW: 4, labelH: 2, cols: 2, rows: 5, marginLeft: 0.15625, marginTop: 0.5, gapX: 0.1875, gapY: 0 },
  { id: "avery5164", name: "Avery 5164 · 6 per sheet", description: '4 × 3⅓" bin and shelf labels, letter paper', pageW: 8.5, pageH: 11, labelW: 4, labelH: 3.333, cols: 2, rows: 3, marginLeft: 0.15625, marginTop: 0.5, gapX: 0.1875, gapY: 0 },
  { id: "avery5167", name: "Avery 5167 · 80 per sheet", description: '1¾ × ½" return-address labels for small parts', pageW: 8.5, pageH: 11, labelW: 1.75, labelH: 0.5, cols: 4, rows: 20, marginLeft: 0.3, marginTop: 0.5, gapX: 0.3, gapY: 0 },
  { id: "avery22806", name: "Avery 22806 · 12 per sheet", description: '2 × 2" square labels, good for QR codes', pageW: 8.5, pageH: 11, labelW: 2, labelH: 2, cols: 3, rows: 4, marginLeft: 0.9375, marginTop: 0.5, gapX: 0.3125, gapY: 0.5 },
  { id: "a4-l7160", name: "Avery L7160 · 21 per sheet (A4)", description: "63.5 × 38.1 mm labels, A4 paper", pageW: 8.27, pageH: 11.69, labelW: 2.5, labelH: 1.5, cols: 3, rows: 7, marginLeft: 0.28, marginTop: 0.6, gapX: 0.1, gapY: 0 },
  { id: "roll-2x1", name: 'Roll · 2 × 1"', description: "Thermal label printers (Dymo, Zebra, Rollo)", pageW: 2, pageH: 1, labelW: 2, labelH: 1, cols: 1, rows: 1, marginLeft: 0, marginTop: 0, gapX: 0, gapY: 0, roll: true },
  { id: "roll-2.25x1.25", name: 'Roll · 2¼ × 1¼"', description: "Thermal label printers", pageW: 2.25, pageH: 1.25, labelW: 2.25, labelH: 1.25, cols: 1, rows: 1, marginLeft: 0, marginTop: 0, gapX: 0, gapY: 0, roll: true },
  { id: "roll-3x2", name: 'Roll · 3 × 2"', description: "Thermal label printers, bin and shelf labels", pageW: 3, pageH: 2, labelW: 3, labelH: 2, cols: 1, rows: 1, marginLeft: 0, marginTop: 0, gapX: 0, gapY: 0, roll: true },
  { id: "roll-4x6", name: 'Roll · 4 × 6"', description: "Pallet and location placards", pageW: 4, pageH: 6, labelW: 4, labelH: 6, cols: 1, rows: 1, marginLeft: 0, marginTop: 0, gapX: 0, gapY: 0, roll: true },
  { id: "custom", name: "Custom", description: "Set the label and page size yourself", pageW: 8.5, pageH: 11, labelW: 2.625, labelH: 1, cols: 3, rows: 10, marginLeft: 0.1875, marginTop: 0.5, gapX: 0.125, gapY: 0 },
];

export function templateById(id: string | undefined): LabelTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0]!;
}

/** Templates by id, name or a loose description ("avery 5160", "2x1 roll", "4x6"). */
export function findTemplate(query: string | undefined): LabelTemplate | undefined {
  if (!query) return undefined;
  const q = query.toLowerCase().replace(/[^a-z0-9.]+/g, "");
  return TEMPLATES.find((t) => t.id.replace(/[^a-z0-9.]+/g, "") === q) ?? TEMPLATES.find((t) => t.name.toLowerCase().replace(/[^a-z0-9.]+/g, "").includes(q)) ?? TEMPLATES.find((t) => q.includes(t.id.replace(/[^a-z0-9.]+/g, "").replace(/^avery|^roll/, "")) && q.length >= 3);
}

export interface LabelFields {
  /** Name of the item, location, supplier, or the batch's item. */
  name: boolean;
  /** The code in letters under or beside the bars. */
  code: boolean;
  /** Sell price on item labels. */
  price: boolean;
  /** Category and bin, location kind, batch received date and so on. */
  detail: boolean;
}

export interface LabelSpec {
  kind: LabelKind;
  templateId: string;
  /** Overrides for the custom template (inches). */
  custom?: Partial<Pick<LabelTemplate, "pageW" | "pageH" | "labelW" | "labelH" | "cols" | "rows" | "marginLeft" | "marginTop" | "gapX" | "gapY" | "roll">>;
  symbology: Symbology;
  encode: EncodeMode;
  fields: LabelFields;
  /** Labels per record. */
  copies: number;
  /** Positions to skip on the first sheet (a partly used sheet). */
  startAt: number;
  /** 1 = sized to the label; 0.75 smaller, 1.5 larger. */
  textScale: number;
  /** A hairline around each label, for plain paper and cutting. */
  border: boolean;
}

export const DEFAULT_SPEC: LabelSpec = {
  kind: "item",
  templateId: "avery5160",
  symbology: "qrcode",
  encode: "link",
  fields: { name: true, code: true, price: false, detail: true },
  copies: 1,
  startAt: 0,
  textScale: 1,
  border: false,
};

/** The template with any custom dimensions applied. */
export function resolveTemplate(spec: Pick<LabelSpec, "templateId" | "custom">): LabelTemplate {
  const base = templateById(spec.templateId);
  if (spec.templateId !== "custom" || !spec.custom) return base;
  const t = { ...base, ...spec.custom };
  const clamp = (v: number, lo: number, hi: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
  t.labelW = clamp(t.labelW, 0.3, 12);
  t.labelH = clamp(t.labelH, 0.3, 12);
  t.pageW = clamp(t.pageW, t.labelW, 20);
  t.pageH = clamp(t.pageH, t.labelH, 20);
  t.cols = Math.max(1, Math.floor(clamp(t.cols, 1, 40)));
  t.rows = Math.max(1, Math.floor(clamp(t.rows, 1, 60)));
  t.marginLeft = clamp(t.marginLeft, 0, t.pageW);
  t.marginTop = clamp(t.marginTop, 0, t.pageH);
  t.gapX = clamp(t.gapX, 0, 5);
  t.gapY = clamp(t.gapY, 0, 5);
  return t;
}

export function labelsPerPage(t: LabelTemplate): number {
  return t.cols * t.rows;
}
