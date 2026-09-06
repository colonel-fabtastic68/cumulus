import type { ImportRow } from "@/lib/inventory";
import type { Item } from "@/lib/types";

/** Item fields a spreadsheet column can be mapped to. Order matches the template CSV. */
export const TARGET_FIELDS = [
  "sku",
  "name",
  "description",
  "category",
  "type",
  "unit",
  "qty",
  "unitCost",
  "price",
  "salePrice",
  "minQty",
  "maxQty",
  "leadTimeDays",
  "location",
  "barcode",
  "supplierName",
  "brand",
  "tags",
  "weight",
  "length",
  "width",
  "height",
  "imageUrl",
  "externalId",
  "published",
] as const;

export type TargetField = (typeof TARGET_FIELDS)[number];
/** A column mapped to a custom attribute created on the fly, e.g. "custom:Shipping class". */
export type CustomTarget = `custom:${string}`;
export type MappingTarget = TargetField | CustomTarget | "ignore";

/** Source header -> target field. Every header in the source has an entry. */
export type ColumnMapping = Record<string, MappingTarget>;

export const FIELD_LABELS: Record<TargetField | "ignore", string> = {
  sku: "SKU",
  name: "Name",
  description: "Description",
  category: "Category",
  type: "Type (part / assembly)",
  unit: "Unit of measure",
  qty: "On-hand quantity",
  unitCost: "Unit cost",
  price: "Price",
  salePrice: "Sale price",
  minQty: "Min quantity",
  maxQty: "Max quantity",
  leadTimeDays: "Lead time (days)",
  location: "Location / bin",
  barcode: "Barcode / GTIN",
  supplierName: "Supplier",
  brand: "Brand",
  tags: "Tags",
  weight: "Weight",
  length: "Length",
  width: "Width",
  height: "Height",
  imageUrl: "Image URL",
  externalId: "External id (Shopify / WooCommerce)",
  published: "Published / active",
  ignore: "Ignore column",
};

export const NUMERIC_FIELDS: ReadonlySet<TargetField> = new Set<TargetField>(["qty", "unitCost", "price", "salePrice", "minQty", "maxQty", "leadTimeDays", "weight", "length", "width", "height"]);

export function isCustomTarget(t: MappingTarget | string): t is CustomTarget {
  return typeof t === "string" && t.startsWith("custom:") && t.length > 7;
}
export function customFieldName(t: CustomTarget): string {
  return t.slice(7);
}
export function customTarget(name: string): CustomTarget {
  return `custom:${name.trim()}`;
}
export function targetLabel(t: MappingTarget): string {
  return isCustomTarget(t) ? customFieldName(t) : FIELD_LABELS[t];
}

export type SourceKind = "shopify" | "woocommerce" | "generic";

export interface ParsedSource {
  /** File name, or "Pasted data". */
  name: string;
  headers: string[];
  rows: Record<string, string>[];
  /** Parser warnings worth surfacing (field count mismatches etc). */
  warnings: string[];
  kind: SourceKind;
}

export type WizardStep = 1 | 2 | 3 | 4;

export type ReviewStatus = "new" | "update" | "error";

export interface ReviewRow {
  /** 1-based row number in the source (header excluded). */
  line: number;
  sku: string;
  status: ReviewStatus;
  message?: string;
  row: ImportRow;
  existing?: Item;
  /** For updates: fields whose incoming value differs from the item's current value. */
  changedFields: string[];
}
