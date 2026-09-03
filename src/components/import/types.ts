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
  "minQty",
  "maxQty",
  "leadTimeDays",
  "location",
  "barcode",
  "supplierName",
  "tags",
] as const;

export type TargetField = (typeof TARGET_FIELDS)[number];
export type MappingTarget = TargetField | "ignore";

/** Source header -> target field. Every header in the source has an entry. */
export type ColumnMapping = Record<string, MappingTarget>;

export const FIELD_LABELS: Record<MappingTarget, string> = {
  sku: "SKU",
  name: "Name",
  description: "Description",
  category: "Category",
  type: "Type (part / assembly)",
  unit: "Unit of measure",
  qty: "On-hand quantity",
  unitCost: "Unit cost",
  price: "Price",
  minQty: "Min quantity",
  maxQty: "Max quantity",
  leadTimeDays: "Lead time (days)",
  location: "Location / bin",
  barcode: "Barcode",
  supplierName: "Supplier",
  tags: "Tags",
  ignore: "Ignore column",
};

export const NUMERIC_FIELDS: ReadonlySet<TargetField> = new Set<TargetField>(["qty", "unitCost", "price", "minQty", "maxQty", "leadTimeDays"]);

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
}
