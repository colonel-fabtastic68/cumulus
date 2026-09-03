import Papa from "papaparse";
import { TARGET_FIELDS } from "./types";

const EXAMPLE_ROWS: string[][] = [
  ["SW-3PDT-BLU", "3PDT footswitch, blue", "Latching 3PDT stomp switch", "Electronics", "part", "ea", "320", "2.35", "4.50", "150", "600", "6", "E-01", "", "Love My Switches", "switch|blue"],
  ["FG-OD1-BLK", "Halcyon Overdrive, black", "Finished pedal, boxed", "Finished goods", "assembly", "ea", "12", "0", "189.00", "5", "30", "", "F-01", "0123456789012", "", "pedal|overdrive"],
];

export function buildTemplateCsv(): string {
  return Papa.unparse({ fields: [...TARGET_FIELDS], data: EXAMPLE_ROWS });
}

/** Build a CSV Blob in the browser and trigger a download. */
export function downloadTemplateCsv(): void {
  const blob = new Blob([buildTemplateCsv()], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cumulus-import-template.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
