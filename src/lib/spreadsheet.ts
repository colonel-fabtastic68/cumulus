/**
 * Excel and OpenDocument spreadsheets in the browser, read with SheetJS
 * (loaded only when a spreadsheet is opened). Cells come back as the text the
 * sheet displays, so prices like "$70.00" and dates read the way they look.
 */

export const SPREADSHEET_ACCEPT = ".xlsx,.xlsm,.xls,.ods,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,application/vnd.oasis.opendocument.spreadsheet";

export function isSpreadsheetFile(file: Pick<File, "name" | "type">): boolean {
  return /\.(xlsx|xlsm|xls|ods)$/i.test(file.name) || /spreadsheetml|ms-excel|opendocument\.spreadsheet/.test(file.type);
}

/** The first sheet that has anything in it, as rows of display text. */
export async function readSpreadsheet(file: File): Promise<{ sheet: string; rows: string[][] }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "", blankrows: false }).map((r) => r.map((c) => String(c ?? "").trim()));
    if (rows.some((r) => r.some(Boolean))) return { sheet: name, rows };
  }
  return { sheet: wb.SheetNames[0] ?? "", rows: [] };
}

/** The header row: the first of the opening rows filled in nearly as widely as the widest, so title lines above a table are skipped. */
export function headerRowIndex(rows: string[][]): number {
  const head = rows.slice(0, 20);
  const widest = Math.max(0, ...head.map((r) => r.filter(Boolean).length));
  const i = head.findIndex((r) => r.filter(Boolean).length >= Math.max(2, Math.ceil(widest * 0.6)));
  return i < 0 ? 0 : i;
}

/** From the header row on, as tab-separated text (for readers that take pasted cells). */
export function rowsToTsv(rows: string[][]): string {
  return rows
    .slice(headerRowIndex(rows))
    .map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, " ")).join("\t"))
    .join("\n");
}
