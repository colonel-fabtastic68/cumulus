import Papa from "papaparse";
import { uniq } from "@/lib/utils";
import { detectSourceKind } from "./mapping";
import type { ParsedSource } from "./types";

type RawRow = Record<string, unknown>;

const PARSE_OPTIONS = {
  header: true as const,
  skipEmptyLines: "greedy" as const,
  transformHeader: (h: string) => h.trim(),
};

function cellToString(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map(cellToString).join(" ");
  return String(v);
}

/** Normalise a Papa result into headers + string rows, dropping blank columns and rows. */
export function toParsedSource(name: string, results: Papa.ParseResult<RawRow>): ParsedSource {
  const headers = uniq((results.meta.fields ?? []).map((h) => h.trim()).filter((h) => h && h !== "__parsed_extra"));
  const rows = results.data
    .map((raw) => Object.fromEntries(headers.map((h) => [h, cellToString(raw[h]).trim()])) as Record<string, string>)
    .filter((row) => headers.some((h) => row[h] !== ""));
  const warnings: string[] = [];
  if (results.errors.length) {
    const mismatches = results.errors.filter((e) => e.type === "FieldMismatch").length;
    if (mismatches) warnings.push(`${mismatches} row${mismatches === 1 ? "" : "s"} had a different number of fields than the header.`);
    const other = results.errors.filter((e) => e.type !== "FieldMismatch");
    for (const e of other.slice(0, 3)) warnings.push(e.message);
  }
  return { name, headers, rows, warnings, kind: detectSourceKind(headers) };
}

export function parseFile(file: File): Promise<ParsedSource> {
  return new Promise((resolve, reject) => {
    Papa.parse<RawRow>(file, {
      ...PARSE_OPTIONS,
      complete: (results) => resolve(toParsedSource(file.name, results)),
      error: (err) => reject(err),
    });
  });
}

/** Pasted spreadsheet cells are tab-separated; guess tabs first but accept commas too. */
export function parsePasted(text: string): ParsedSource {
  const results = Papa.parse<RawRow>(text.replace(/^﻿/, ""), { ...PARSE_OPTIONS, delimitersToGuess: ["\t", ",", ";", "|"] });
  return toParsedSource("Pasted data", results);
}
