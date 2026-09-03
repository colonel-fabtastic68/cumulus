import type { Item } from "@/lib/types";
import { round } from "@/lib/utils";

function csvEscape(value: unknown): string {
  const s = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADER = [
  "SKU",
  "Name",
  "Category",
  "Type",
  "Status",
  "On hand",
  "Unit",
  "Min qty",
  "Max qty",
  "Unit cost",
  "Price",
  "Value",
  "Supplier",
  "Supplier SKU",
  "Lead time days",
  "Location",
  "Barcode",
  "Tags",
  "Updated",
];

/** Serialise items as CSV (RFC 4180 line endings, quoted where needed). */
export function itemsToCsv(items: Item[], supplierName: (id?: string) => string | undefined): string {
  const lines = items.map((i) =>
    [
      i.sku,
      i.name,
      i.category,
      i.type,
      i.status,
      i.onHand,
      i.unit,
      i.minQty,
      i.maxQty,
      i.unitCost,
      i.price,
      round(i.onHand * i.unitCost),
      supplierName(i.supplierId),
      i.supplierSku,
      i.leadTimeDays,
      i.location,
      i.barcode,
      i.tags.join("; "),
      i.updatedAt,
    ]
      .map(csvEscape)
      .join(","),
  );
  return [HEADER.join(","), ...lines].join("\r\n");
}

/** Trigger a browser download of a CSV string via a Blob and a temporary anchor. */
export function downloadCsv(filename: string, csv: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
