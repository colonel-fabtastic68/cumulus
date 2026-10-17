"use client";

import { useRef, useState, type DragEvent } from "react";
import { ArrowRight, ClipboardPaste, FileDown, FileSpreadsheet, UploadCloud, X } from "lucide-react";
import { Badge, Banner, Button, Card, CardHeader, TextArea, useToast } from "@/components/ui";
import { pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { parseFile, parsePasted } from "./parse";
import { SPREADSHEET_ACCEPT, isSpreadsheetFile } from "@/lib/spreadsheet";
import { DOCUMENT_ACCEPT, DocumentReader, isDocumentFile } from "./DocumentReader";
import { downloadTemplateCsv } from "./template";
import type { ParsedSource } from "./types";

const KIND_LABEL = { shopify: "Shopify export", woocommerce: "WooCommerce export", generic: "Spreadsheet" } as const;

interface UploadStepProps {
  source: ParsedSource | null;
  onSource: (source: ParsedSource) => void;
  onClear: () => void;
  onContinue: () => void;
  /** A line about the business for Strato when it reads documents. */
  hint?: string;
}

export function UploadStep({ source, onSource, onClear, onContinue, hint }: UploadStepProps) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pasted, setPasted] = useState("");
  /** Photos, PDFs and text that is not a table go to Strato's reader below. */
  const [forStrato, setForStrato] = useState<File[] | null>(null);

  const acceptFile = async (file: File | undefined) => {
    if (!file) return;
    const tabular = /\.(csv|tsv|txt)$/i.test(file.name) || /text\/(csv|tab-separated-values|plain)/.test(file.type) || isSpreadsheetFile(file);
    if (!tabular) {
      if (isDocumentFile(file)) {
        setForStrato([file]);
        return;
      }
      toast("Choose a spreadsheet (.xlsx, .csv, .tsv, .txt), a photo, a PDF or an XML file.", "critical");
      return;
    }
    setBusy(true);
    try {
      const parsed = await parseFile(file);
      // A .txt with no columns is a plain list (or prose): let Strato read it instead.
      if (parsed.headers.length < 2 && /\.txt$/i.test(file.name)) {
        setForStrato([file]);
        return;
      }
      if (parsed.headers.length === 0) {
        toast("No header row found in that file.", "critical");
        return;
      }
      onSource(parsed);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not read that file.", "critical");
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    void acceptFile(e.dataTransfer.files?.[0]);
  };

  const usePasted = () => {
    const parsed = parsePasted(pasted);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      toast("Paste a header row followed by at least one data row.", "critical");
      return;
    }
    onSource(parsed);
  };

  return (
    <div className="flex flex-col gap-4">
      {source ? (
        <Card>
          <CardHeader
            title={
              <span className="inline-flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-text-tertiary" />
                {source.name}
              </span>
            }
            subtitle={`${pluralize(source.rows.length, "row")} · ${pluralize(source.headers.length, "column")} · ${KIND_LABEL[source.kind]}`}
            actions={
              <Button size="sm" variant="plain" icon={<X />} onClick={onClear}>
                Remove
              </Button>
            }
          />
          {source.warnings.length > 0 && (
            <Banner tone="warning" className="mb-3">
              {source.warnings.join(" ")}
            </Banner>
          )}
          <div className="text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Detected headers</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {source.headers.map((h) => (
              <Badge key={h}>{h}</Badge>
            ))}
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" iconRight={<ArrowRight />} onClick={onContinue} disabled={source.rows.length === 0}>
              Continue to mapping
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
          <Card>
            <CardHeader title="Upload a file" subtitle="Excel, CSV or tab-separated, with a header row. Shopify, WooCommerce, Square, Clover and QuickBooks exports work as-is." />
            <div
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  inputRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (!dragging) setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius)] border border-dashed px-6 py-10 text-center transition-colors",
                dragging ? "border-accent bg-accent-soft" : "border-border-strong bg-surface-subdued hover:bg-surface-hover",
              )}
            >
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface text-text-secondary shadow-[0_0_0_1px_var(--border)]">
                <UploadCloud className="h-5 w-5" />
              </span>
              <div className="text-[13.5px] font-medium text-text">{busy ? "Reading file…" : "Drop a file here, or click to choose"}</div>
              <div className="mt-1 text-[12.5px] text-text-secondary">Excel (.xlsx), .csv, .tsv, .txt, .xml, .pdf or photos</div>
              <input
                ref={inputRef}
                type="file"
                accept={`.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain,${SPREADSHEET_ACCEPT},${DOCUMENT_ACCEPT}`}
                className="hidden"
                onChange={(e) => {
                  void acceptFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-[12.5px] text-text-secondary">
              <span>Need a starting point?</span>
              <Button size="sm" variant="plain" icon={<FileDown />} onClick={downloadTemplateCsv}>
                Download template CSV
              </Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="Paste from a spreadsheet" subtitle="Copy cells from Excel or Google Sheets, including the header row, and paste them here." />
            <TextArea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={"sku\tname\tqty\tunitCost\nSW-3PDT-BLU\t3PDT footswitch, blue\t320\t2.35"}
              className="min-h-[164px] font-mono text-[12px]"
              spellCheck={false}
            />
            <div className="mt-3 flex justify-end">
              <Button icon={<ClipboardPaste />} onClick={usePasted} disabled={!pasted.trim()}>
                Use pasted data
              </Button>
            </div>
          </Card>
          <Card className="@3xl:col-span-2">
            <CardHeader title="Paper, PDFs and other documents" subtitle="Count sheets, notebooks, supplier price lists, an XML export: Strato reads them into a table that goes through the same mapping and review." />
            <DocumentReader onSource={onSource} hint={hint} incoming={forStrato} />
          </Card>
        </div>
      )}
    </div>
  );
}
