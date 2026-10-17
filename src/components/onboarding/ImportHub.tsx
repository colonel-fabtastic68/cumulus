"use client";

import { useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, ClipboardPaste, FileSpreadsheet, FileText, NotebookPen, Plug, Sparkles, UploadCloud } from "lucide-react";
import { Badge, Button, Card, TextArea, useToast } from "@/components/ui";
import { DOCUMENT_ACCEPT, DocumentReader, isDocumentFile, type ReadMeta } from "@/components/import/DocumentReader";
import { parseFile, parsePasted } from "@/components/import/parse";
import type { ParsedSource } from "@/components/import/types";
import { WebsiteImport } from "@/components/import/WebsiteImport";
import { SPREADSHEET_ACCEPT, isSpreadsheetFile } from "@/lib/spreadsheet";
import { describeAnswers, sourceOption } from "@/lib/onboarding";
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
 * The import step of the guided setup. The first answer (what the business
 * uses today) picks which cards lead: each named source gets the steps to
 * export from it and a drop target; paper records lead with the camera.
 * Every way in is always available further down.
 */
export function ImportHub({ answers, onSource, onWebsiteImported }: ImportHubProps) {
  const toast = useToast();
  const hint = describeAnswers(answers);
  const [forStrato, setForStrato] = useState<File[] | null>(null);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const readerRef = useRef<HTMLDivElement>(null);

  const sources = (answers.sources ?? []).map(sourceOption).filter((s): s is NonNullable<typeof s> => !!s);
  const paper = sources.some((s) => s.id === "paper");
  const named = sources.filter((s) => s.id !== "paper" && s.id !== "memory");
  const memory = sources.some((s) => s.id === "memory");

  const acceptFiles = async (files: FileList | File[] | null | undefined) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const docs = list.filter((f) => isDocumentFile(f) && !isSpreadsheetFile(f) && !/\.(csv|tsv|txt)$/i.test(f.name));
    const table = list.find((f) => !docs.includes(f));
    if (docs.length) {
      setForStrato(docs);
      readerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (!table) return;
    setBusy(true);
    try {
      const parsed = await parseFile(table);
      if (parsed.headers.length < 2 && /\.txt$/i.test(table.name)) {
        setForStrato([table]);
        readerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
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
      const file = new File([pasted], "Pasted list.txt", { type: "text/plain" });
      setForStrato([file]);
      readerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    onSource(parsed, "paste");
  };

  const onDocument = (source: ParsedSource, meta: ReadMeta) => {
    toast(`Strato read ${meta.files === 1 ? "the document" : `${meta.files} documents`}: ${source.rows.length} rows`, "success");
    onSource(source, "paper");
  };

  const reader = (
    <div ref={readerRef}>
      <HubCard
        icon={<NotebookPen />}
        title={paper ? "Your paper records" : "Photos, PDFs and other documents"}
        subtitle={paper ? "Photograph every page of the count sheet or notebook, then let Strato read it. Check the table before it imports." : "A supplier price list, a PDF stock report, an XML export: Strato reads it into a table."}
        badge={<Badge tone="magic">Strato</Badge>}
      >
        <DocumentReader onSource={onDocument} hint={hint} incoming={forStrato} prominent={paper} />
      </HubCard>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {paper && reader}

      {named.map((s) => (
        <HubCard
          key={s.id}
          icon={<FileSpreadsheet />}
          title={s.id === "other-app" && answers.otherSource ? `Export from ${answers.otherSource}` : `Export from ${s.label}`}
          subtitle={s.export?.formats ? `Accepted: ${s.export.formats}` : undefined}
          badge={s.integrationId ? <Badge tone="info">Can also connect live</Badge> : undefined}
        >
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_260px]">
            <ol className="flex flex-col gap-2">
              {(s.export?.steps ?? []).map((step, i) => (
                <li key={i} className="flex gap-3 text-[13px] leading-5 text-text-secondary">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-subdued text-[11px] font-semibold text-text">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
              {s.export?.note && <li className="pl-8 text-[12.5px] text-text-tertiary">{s.export.note}</li>}
            </ol>
            <div className="flex flex-col gap-2">
              <DropTarget onFiles={acceptFiles} busy={busy} compact />
              {s.integrationId && (
                <Button variant="plain" size="sm" icon={<Plug />} iconRight={<ArrowUpRight />} href={`/integrations?connect=${s.integrationId}`}>
                  Connect {s.label} live instead
                </Button>
              )}
            </div>
          </div>
        </HubCard>
      ))}

      {!paper && !named.length && (
        <HubCard icon={<UploadCloud />} title="Upload a spreadsheet or export" subtitle="Excel, CSV or tab-separated with a header row. Store and POS exports are recognized as they are.">
          <DropTarget onFiles={acceptFiles} busy={busy} />
        </HubCard>
      )}
      {(paper || named.length > 0) && (
        <HubCard icon={<UploadCloud />} title="Any other file" subtitle="Excel, CSV, tab-separated, XML, PDF or photos. Spreadsheets go straight to mapping; the rest Strato reads first.">
          <DropTarget onFiles={acceptFiles} busy={busy} compact />
        </HubCard>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <HubCard icon={<ClipboardPaste />} title={memory ? "Type or dictate a list" : "Paste from a spreadsheet"} subtitle={memory ? "One item per line, with a count if you know it. Strato turns it into rows." : "Copy the cells, header row included, and paste them here."}>
          <TextArea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={memory ? "Blue 3PDT footswitch, 320\n1/4 in. jack, mono, about 80\nEnclosure 125B, 40" : "sku\tname\tqty\tunitCost\nSW-3PDT-BLU\t3PDT footswitch, blue\t320\t2.35"} className="min-h-[140px] font-mono text-[12px]" spellCheck={false} />
          <div className="mt-3 flex justify-end">
            <Button icon={memory ? <Sparkles /> : <ClipboardPaste />} onClick={usePasted} disabled={!pasted.trim()}>
              {memory ? "Read with Strato" : "Use pasted data"}
            </Button>
          </div>
        </HubCard>
        <WebsiteImport onImported={onWebsiteImported} />
      </div>

      {!paper && reader}

      <p className="text-[12.5px] text-text-tertiary">
        <FileText className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
        Formats: .xlsx, .xls, .ods, .csv, .tsv, .txt, .xml, .json, .pdf and photos (.jpg, .png, .heic). Up to 12 pages per read.
      </p>
    </div>
  );
}

function HubCard({ icon, title, subtitle, badge, children }: { icon: ReactNode; title: ReactNode; subtitle?: ReactNode; badge?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-subdued text-text-secondary [&>svg]:h-[18px] [&>svg]:w-[18px]">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14.5px] font-semibold leading-5 text-text">{title}</h3>
            {badge}
          </div>
          {subtitle && <p className="mt-0.5 text-[12.5px] leading-[18px] text-text-secondary">{subtitle}</p>}
        </div>
      </div>
      {children}
    </Card>
  );
}

function DropTarget({ onFiles, busy, compact }: { onFiles: (files: FileList | null) => void; busy?: boolean; compact?: boolean }) {
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
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center rounded-[var(--radius)] border border-dashed px-4 text-center transition-colors",
        compact ? "py-5" : "py-9",
        dragging ? "border-accent bg-accent-soft" : "border-border-strong bg-surface-subdued hover:bg-surface-hover",
      )}
    >
      <UploadCloud className="mb-2 h-5 w-5 text-text-secondary" />
      <div className="text-[13px] font-medium text-text">{busy ? "Reading file…" : "Drop the file here, or tap to choose"}</div>
      {!compact && <div className="mt-1 text-[12px] text-text-secondary">.xlsx, .csv, .tsv, .txt, .xml, .pdf or photos</div>}
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

