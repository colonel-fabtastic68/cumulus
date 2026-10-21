"use client";

import { useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, ClipboardPaste, FileSpreadsheet, FileText, Globe, NotebookPen, Plug, Sparkles, UploadCloud } from "lucide-react";
import { Badge, Button, TextArea, useToast } from "@/components/ui";
import { DOCUMENT_ACCEPT, DocumentReader, isDocumentFile, type ReadMeta } from "@/components/import/DocumentReader";
import { parseFile, parsePasted } from "@/components/import/parse";
import type { ParsedSource } from "@/components/import/types";
import { WebsiteImport } from "@/components/import/WebsiteImport";
import { SPREADSHEET_ACCEPT, isSpreadsheetFile } from "@/lib/spreadsheet";
import { describeAnswers, sourceOption, type SourceOption } from "@/lib/onboarding";
import type { OnboardingAnswers } from "@/lib/types";
import { cn } from "@/lib/utils";

export type ImportVia = NonNullable<OnboardingAnswers["importedVia"]>;

interface ImportHubProps {
  answers: OnboardingAnswers;
  onSource: (source: ParsedSource, via: ImportVia) => void;
  /** The website import writes items itself; the hub only needs to know it happened. */
  onWebsiteImported: () => void;
}

const FILE_ACCEPT = `.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain,${SPREADSHEET_ACCEPT},${DOCUMENT_ACCEPT}`;

/**
 * The import step of the guided setup: three big doors in. Files from the
 * tools named earlier (with the steps to export from each), paper and
 * photos read by Strato, and pasting or reading the website. Everything
 * lands on the same mapping and review screens.
 */
export function ImportHub({ answers, onSource, onWebsiteImported }: ImportHubProps) {
  const toast = useToast();
  const hint = describeAnswers(answers);
  const [forStrato, setForStrato] = useState<File[] | null>(null);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const readerRef = useRef<HTMLDivElement>(null);

  const sources = (answers.sources ?? []).map(sourceOption).filter((s): s is SourceOption => !!s);
  const paper = sources.some((s) => s.id === "paper");
  const memory = sources.some((s) => s.id === "memory");
  const named = sources.filter((s) => s.id !== "paper" && s.id !== "memory");
  const generic = sourceOption("spreadsheet")!;
  const tabs: SourceOption[] = named.length ? [...named, ...(named.some((s) => s.id === "spreadsheet") ? [] : [generic])] : [generic];
  const [tab, setTab] = useState(tabs[0]!.id);
  const current = tabs.find((t) => t.id === tab) ?? tabs[0]!;

  const toReader = (files: File[]) => {
    setForStrato(files);
    readerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const acceptFiles = async (files: FileList | File[] | null | undefined) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const docs = list.filter((f) => isDocumentFile(f) && !isSpreadsheetFile(f) && !/\.(csv|tsv|txt)$/i.test(f.name));
    const table = list.find((f) => !docs.includes(f));
    if (docs.length) toReader(docs);
    if (!table) return;
    setBusy(true);
    try {
      const parsed = await parseFile(table);
      if (parsed.headers.length < 2 && /\.txt$/i.test(table.name)) {
        toReader([table]);
        return;
      }
      if (parsed.headers.length === 0) {
        toast("No header row found in that file.", "critical");
        return;
      }
      onSource(parsed, "file");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not read that file.", "critical");
    } finally {
      setBusy(false);
    }
  };

  const usePasted = () => {
    const parsed = parsePasted(pasted);
    if (parsed.headers.length < 2 || parsed.rows.length === 0) {
      // A plain list with one thing per line is not a table: Strato turns it into rows.
      toReader([new File([pasted], "Pasted list.txt", { type: "text/plain" })]);
      return;
    }
    onSource(parsed, "paste");
  };

  const onDocument = (source: ParsedSource, meta: ReadMeta) => {
    toast(`Strato read ${meta.files === 1 ? "the document" : `${meta.files} documents`}: ${source.rows.length} rows`, "success");
    onSource(source, "paper");
  };

  const sourceTitle = current.id === "other-app" && answers.otherSource ? answers.otherSource : current.id === "spreadsheet" ? "a spreadsheet" : current.label;

  return (
    <div className="flex flex-col gap-4">
      <div className={cn("grid gap-4 lg:grid-cols-3", paper && "lg:[&>*:nth-child(2)]:order-first")}>
        {/* 1 · Files from the tools they named */}
        <BigCard index={0} icon={<FileSpreadsheet />} title={`Export from ${sourceTitle}`} subtitle={named.length ? "The steps for each tool you use, then drop the file here." : "Excel, Google Sheets or Numbers with a header row; store and POS exports are recognized as they are."}>
          {tabs.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {tabs.map((t) => (
                <button key={t.id} type="button" aria-pressed={t.id === tab} onClick={() => setTab(t.id)} className={cn("h-7 rounded-full border px-2.5 text-[12px] font-medium transition-colors", t.id === tab ? "border-primary bg-primary text-text-inverse" : "border-border bg-surface text-text-secondary hover:bg-surface-hover hover:text-text")}>
                  {t.id === "other-app" && answers.otherSource ? answers.otherSource : t.id === "spreadsheet" ? "Spreadsheet" : t.label}
                </button>
              ))}
            </div>
          )}
          <ol className="flex flex-col gap-2">
            {(current.export?.steps ?? []).map((step, i) => (
              <li key={`${current.id}-${i}`} className="flex gap-2.5 text-[13px] leading-5 text-text-secondary">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-subdued text-[11px] font-semibold text-text">{i + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          {current.export?.formats && <p className="mt-2 text-[12px] text-text-tertiary">Accepted: {current.export.formats}</p>}
          <div className="mt-auto pt-4">
            <DropTarget onFiles={acceptFiles} busy={busy} />
            {current.integrationId && (
              <Button variant="plain" size="sm" icon={<Plug />} iconRight={<ArrowUpRight />} href={`/integrations?connect=${current.integrationId}`} className="mt-2">
                Connect {current.label} live instead
              </Button>
            )}
          </div>
        </BigCard>

        {/* 2 · Paper, photos, PDFs */}
        <div ref={readerRef} className="flex">
          <BigCard index={1} icon={<NotebookPen />} title={paper ? "Your paper records" : "Paper, photos and PDFs"} subtitle={paper ? "Photograph every page of the count sheet or notebook. Strato reads it into a table you check before anything imports." : "Count sheets, a supplier price list, a PDF stock report or an XML export: Strato reads it into a table."} badge={<Badge tone="magic">Strato</Badge>}>
            <div className="mt-auto">
              <DocumentReader onSource={onDocument} hint={hint} incoming={forStrato} prominent />
            </div>
          </BigCard>
        </div>

        {/* 3 · Paste, dictate, or read the website */}
        <BigCard index={2} icon={memory ? <Sparkles /> : <ClipboardPaste />} title={memory ? "Type or dictate a list" : "Paste, or read your website"} subtitle={memory ? "One item per line, with a count if you know it. Strato turns it into rows." : "Copy cells from a spreadsheet, header row included. Or paste your shop's address and the catalog comes in."}>
          <TextArea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={memory ? "Blue 3PDT footswitch, 320\n1/4 in. jack, mono, about 80\nEnclosure 125B, 40" : "sku\tname\tqty\tunitCost\nSW-3PDT-BLU\t3PDT footswitch, blue\t320\t2.35"} className="min-h-[150px] font-mono text-[12px]" spellCheck={false} />
          <div className="mt-2 flex justify-end">
            <Button icon={memory ? <Sparkles /> : <ClipboardPaste />} onClick={usePasted} disabled={!pasted.trim()}>
              {memory ? "Read with Strato" : "Use pasted data"}
            </Button>
          </div>
          <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-text-tertiary">
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-text">
            <Globe className="h-4 w-4 text-text-secondary" />
            Read your website
          </div>
          <WebsiteImport embedded onImported={onWebsiteImported} />
        </BigCard>
      </div>

      <p className="text-[12.5px] text-text-tertiary">
        <FileText className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
        Formats: .xlsx, .xls, .ods, .csv, .tsv, .txt, .xml, .json, .pdf and photos (.jpg, .png, .heic). Up to 12 pages per read.
      </p>
    </div>
  );
}

function BigCard({ index, icon, title, subtitle, badge, children }: { index: number; icon: ReactNode; title: ReactNode; subtitle?: ReactNode; badge?: ReactNode; children: ReactNode }) {
  return (
    <section className="float-in flex min-h-[460px] w-full flex-col rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-[var(--shadow-card)]" style={{ animationDelay: `${120 + index * 110}ms` }}>
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-subdued text-text-secondary [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[16px] font-semibold leading-6 text-text">{title}</h3>
          {badge}
        </div>
        {subtitle && <p className="mt-1 text-[13px] leading-5 text-text-secondary">{subtitle}</p>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

function DropTarget({ onFiles, busy }: { onFiles: (files: FileList | null) => void; busy?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
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
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles(e.dataTransfer.files);
      }}
      className={cn("flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius)] border border-dashed px-4 py-7 text-center transition-colors", dragging ? "border-accent bg-accent-soft" : "border-border-strong bg-surface-subdued hover:bg-surface-hover")}
    >
      <UploadCloud className="mb-2 h-5 w-5 text-text-secondary" />
      <div className="text-[13px] font-medium text-text">{busy ? "Reading file…" : "Drop the file here, or tap to choose"}</div>
      <div className="mt-1 text-[12px] text-text-secondary">.xlsx, .csv, .tsv, .txt, .xml, .pdf or photos</div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={FILE_ACCEPT}
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
