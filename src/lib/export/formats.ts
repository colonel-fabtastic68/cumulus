import type { Cell, Dataset, ExportSource, ItemScope } from "./datasets";
import { buildXlsx } from "./xlsx";
import { buildZip } from "./zip";

export type ExportFormat = "csv" | "tsv" | "xlsx" | "json" | "jsonl" | "md" | "pdf";

export const FORMATS: Array<{ value: ExportFormat; label: string; hint: string }> = [
  { value: "csv", label: "CSV", hint: "Opens anywhere; one file per dataset, zipped when there are several." },
  { value: "xlsx", label: "Excel (XLSX)", hint: "One workbook, a sheet per dataset." },
  { value: "json", label: "JSON", hint: "Objects keyed by column, one file, for other systems and scripts." },
  { value: "jsonl", label: "JSON Lines", hint: "One object per line, for streaming ingestion." },
  { value: "tsv", label: "TSV", hint: "Tab-separated, pastes cleanly into spreadsheets." },
  { value: "md", label: "Markdown", hint: "Tables in a .md file for docs and chat." },
  { value: "pdf", label: "PDF (print)", hint: "A print view opens; choose Save as PDF." },
];

export interface Table {
  id: string;
  label: string;
  headers: string[];
  rows: Cell[][];
}

export function buildTables(datasets: Dataset[], src: ExportSource, scope: ItemScope): Table[] {
  return datasets.map((d) => ({ id: d.id, label: d.label, ...d.build(src, scope) }));
}

const cellText = (v: Cell) => (v === null || v === undefined ? "" : typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v));

export function delimited(t: Table, sep: "," | "\t"): string {
  const esc = (v: Cell) => {
    const s = cellText(v);
    return sep === "," ? (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s) : s.replace(/[\t\n\r]/g, " ");
  };
  return "﻿" + [t.headers, ...t.rows].map((r) => r.map(esc).join(sep)).join("\r\n");
}

export function toObjects(t: Table): Array<Record<string, Cell>> {
  return t.rows.map((r) => Object.fromEntries(t.headers.map((h, i) => [h, r[i] ?? null])));
}

export function markdown(t: Table): string {
  const esc = (v: Cell) => cellText(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [`## ${t.label}`, "", `| ${t.headers.join(" | ")} |`, `| ${t.headers.map(() => "---").join(" | ")} |`, ...t.rows.map((r) => `| ${r.map(esc).join(" | ")} |`), ""].join("\n");
}

export function stamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Opens a print view with every table; the browser's print dialog offers Save as PDF. */
export function printTables(title: string, tables: Table[]): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html = tables
    .map(
      (t) => `<h2>${esc(t.label)} <span class="muted">(${t.rows.length} rows)</span></h2><table><thead><tr>${t.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${t.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(cellText(c))}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
    )
    .join("");
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>body{font:11px/1.4 -apple-system,Inter,Segoe UI,sans-serif;color:#1a1a1a;margin:24px}h1{font-size:18px;margin:0 0 4px}h2{font-size:13px;margin:18px 0 6px}.muted{color:#666;font-weight:400}table{border-collapse:collapse;width:100%;page-break-inside:auto}th,td{border:1px solid #ddd;padding:3px 5px;text-align:left;vertical-align:top}th{background:#f3f3f3;font-size:10px;text-transform:uppercase;letter-spacing:.03em}tr{page-break-inside:avoid}@page{margin:12mm}</style></head><body><h1>${esc(title)}</h1><div class="muted">Exported ${new Date().toLocaleString()}</div>${html}<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},200)})</script></body></html>`);
  w.document.close();
  return true;
}

/** Produces the file(s) for the chosen format and hands them to the browser. */
export function exportTables(tables: Table[], format: ExportFormat, baseName: string): { files: number; note?: string } {
  const enc = new TextEncoder();
  const base = `${baseName}-${stamp()}`;
  if (tables.length === 0) return { files: 0 };
  switch (format) {
    case "csv":
    case "tsv": {
      const ext = format;
      const sep = format === "csv" ? "," : "\t";
      if (tables.length === 1) {
        downloadBlob(`${base}-${tables[0]!.id}.${ext}`, new Blob([delimited(tables[0]!, sep)], { type: format === "csv" ? "text/csv;charset=utf-8" : "text/tab-separated-values;charset=utf-8" }));
        return { files: 1 };
      }
      downloadBlob(`${base}.zip`, buildZip(tables.map((t) => ({ name: `${t.id}.${ext}`, data: enc.encode(delimited(t, sep)) }))));
      return { files: tables.length, note: "zipped" };
    }
    case "xlsx":
      downloadBlob(`${base}.xlsx`, buildXlsx(tables.map((t) => ({ name: t.label, headers: t.headers, rows: t.rows }))));
      return { files: 1 };
    case "json": {
      const body = tables.length === 1 ? toObjects(tables[0]!) : Object.fromEntries(tables.map((t) => [t.id, toObjects(t)]));
      downloadBlob(`${base}.json`, new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...(tables.length === 1 ? { dataset: tables[0]!.id, rows: body } : { datasets: body }) }, null, 2)], { type: "application/json" }));
      return { files: 1 };
    }
    case "jsonl": {
      if (tables.length === 1) {
        downloadBlob(`${base}-${tables[0]!.id}.jsonl`, new Blob([toObjects(tables[0]!).map((o) => JSON.stringify(o)).join("\n") + "\n"], { type: "application/x-ndjson" }));
        return { files: 1 };
      }
      downloadBlob(`${base}.zip`, buildZip(tables.map((t) => ({ name: `${t.id}.jsonl`, data: enc.encode(toObjects(t).map((o) => JSON.stringify(o)).join("\n") + "\n") }))));
      return { files: tables.length, note: "zipped" };
    }
    case "md":
      downloadBlob(`${base}.md`, new Blob([`# ${baseName}\n\nExported ${new Date().toISOString()}\n\n` + tables.map(markdown).join("\n")], { type: "text/markdown" }));
      return { files: 1 };
    case "pdf":
      return printTables(baseName, tables) ? { files: 1, note: "print" } : { files: 0, note: "blocked" };
  }
}
