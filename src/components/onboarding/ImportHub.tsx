"use client";

import { useRef, useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, ClipboardPaste, FileSpreadsheet, FileText, Globe, NotebookPen, Plug, Sparkles, UploadCloud } from "lucide-react";
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
export type ImportRoute = "files" | "paper" | "paste";

const FILE_ACCEPT = `.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain,${SPREADSHEET_ACCEPT},${DOCUMENT_ACCEPT}`;

interface RouteDef {
  id: ImportRoute;
  icon: ReactNode;
  title: (a: OnboardingAnswers) => string;
  description: (a: OnboardingAnswers) => string;
  points: (a: OnboardingAnswers) => string[];
  badge?: ReactNode;
}

function namedSources(a: OnboardingAnswers): SourceOption[] {
  return (a.sources ?? []).map(sourceOption).filter((s): s is SourceOption => !!s && s.id !== "paper" && s.id !== "memory");
}
const sourceName = (s: SourceOption, a: OnboardingAnswers) => (s.id === "other-app" && a.otherSource ? a.otherSource : s.id === "spreadsheet" ? "Spreadsheets" : s.label);

/** The three ways in. Copy leans on the answers: the tools named earlier, paper, or nothing written down. */
export const IMPORT_ROUTES: RouteDef[] = [
  {
    id: "files",
    icon: <FileSpreadsheet />,
    title: (a) => {
      const named = namedSources(a);
      return named.length ? `A file from ${named.length === 1 ? sourceName(named[0]!, a) : "your tools"}` : "A spreadsheet or export";
    },
    description: (a) => (namedSources(a).length ? "Step-by-step export instructions for each tool you named, then drop the file in." : "Excel, Google Sheets, Numbers or any app that exports a file. Store and POS exports are recognized as they are."),
    points: (a) => {
      const named = namedSources(a).map((s) => sourceName(s, a));
      return [named.length ? `Exports from ${named.slice(0, 3).join(", ")}${named.length > 3 ? " and more" : ""}` : "Excel, CSV, Numbers, Google Sheets", "Columns matched automatically", "Live connection for stores and POS"];
    },
  },
  {
    id: "paper",
    icon: <NotebookPen />,
    title: () => "Paper, photos and PDFs",
    description: () => "Photograph count sheets, notebooks or a whiteboard, or drop a PDF or XML. Strato reads it into a table you check first.",
    points: () => ["Phone camera, straight from the shelf", "Handwriting, printouts, supplier lists", "Every row reviewed before it saves"],
    badge: <Badge tone="magic">Strato</Badge>,
  },
  {
    id: "paste",
    icon: <ClipboardPaste />,
    title: (a) => ((a.sources ?? []).includes("memory") ? "Type it, or read your website" : "Paste, or read your website"),
    description: (a) => ((a.sources ?? []).includes("memory") ? "Dictate a list one item per line and Strato turns it into rows, or paste your shop's address and the catalog comes in." : "Copy cells from a spreadsheet, header row included, or paste your shop's address and the catalog comes in."),
    points: () => ["Paste cells from any spreadsheet", "A plain list becomes rows", "Shopify, WooCommerce or any product site"],
  },
];

export function importRouteTitle(route: ImportRoute, a: OnboardingAnswers): string {
  return IMPORT_ROUTES.find((r) => r.id === route)!.title(a);
}

/** Step 4, first screen: pick a way in. Three tall cards, one tap each. */
export function ImportRoutePicker({ answers, onPick }: { answers: OnboardingAnswers; onPick: (route: ImportRoute) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {IMPORT_ROUTES.map((r, i) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onPick(r.id)}
          style={{ animationDelay: `${i * 110}ms` }}
          className="float-in group flex min-h-[300px] flex-col items-start rounded-[var(--radius-lg)] border border-border bg-surface p-5 text-left shadow-[var(--shadow-card)] transition-[border-color,transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:border-border-strong focus-visible:border-accent focus-visible:outline-none"
        >
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-subdued text-text-secondary [&>svg]:h-5 [&>svg]:w-5">{r.icon}</span>
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[17px] font-semibold leading-6 text-text">{r.title(answers)}</span>
            {r.badge}
          </span>
          <span className="mt-1.5 block text-[13.5px] leading-5 text-text-secondary">{r.description(answers)}</span>
          <ul className="mt-4 flex flex-col gap-1.5">
            {r.points(answers).map((pt) => (
              <li key={pt} className="flex gap-2 text-[13px] leading-5 text-text">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-text-tertiary" />
                {pt}
              </li>
            ))}
          </ul>
          <span className="mt-auto inline-flex items-center gap-1 pt-5 text-[13px] font-medium text-accent group-hover:underline">
            Choose this <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </button>
      ))}
    </div>
  );
}

interface ImportHubProps {
  answers: OnboardingAnswers;
  route: ImportRoute;
  onSource: (source: ParsedSource, via: ImportVia) => void;
  /** The website import writes items itself; the hub only needs to know it happened. */
  onWebsiteImported: () => void;
  /** Photos or PDFs dropped on the files screen belong on the paper screen; the flow switches and hands them over. */
  onRedirectDocuments: (files: File[]) => void;
  /** Files handed over from another route. */
  incoming?: File[] | null;
}

/**
 * Step 4, second screen: the route chosen, full width. Files from the tools
 * named earlier (with the steps to export from each), paper and photos read
 * by Strato, or pasting and reading the website. All land on the same
 * mapping and review screens.
 */
export function ImportHub({ answers, route, onSource, onWebsiteImported, onRedirectDocuments, incoming }: ImportHubProps) {
  const toast = useToast();
  const hint = describeAnswers(answers);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);

  const memory = (answers.sources ?? []).includes("memory");
  const named = namedSources(answers);
  const generic = sourceOption("spreadsheet")!;
  const tabs: SourceOption[] = named.length ? [...named, ...(named.some((s) => s.id === "spreadsheet") ? [] : [generic])] : [generic];
  const [tab, setTab] = useState(tabs[0]!.id);
  const current = tabs.find((t) => t.id === tab) ?? tabs[0]!;

  const acceptFiles = async (files: FileList | File[] | null | undefined) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const docs = list.filter((f) => isDocumentFile(f) && !isSpreadsheetFile(f) && !/\.(csv|tsv|txt)$/i.test(f.name));
    const table = list.find((f) => !docs.includes(f));
    if (docs.length) onRedirectDocuments(docs);
    if (!table) return;
    setBusy(true);
    try {
      const parsed = await parseFile(table);
      if (parsed.headers.length < 2 && /\.txt$/i.test(table.name)) {
        onRedirectDocuments([table]);
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
      onRedirectDocuments([new File([pasted], "Pasted list.txt", { type: "text/plain" })]);
      return;
    }
    onSource(parsed, "paste");
  };

  const onDocument = (source: ParsedSource, meta: ReadMeta) => {
    toast(`Strato read ${meta.files === 1 ? "the document" : `${meta.files} documents`}: ${source.rows.length} rows`, "success");
    onSource(source, "paper");
  };

  if (route === "files")
    return (
      <Panel>
        {tabs.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            {tabs.map((t) => (
              <button key={t.id} type="button" aria-pressed={t.id === tab} onClick={() => setTab(t.id)} className={cn("h-8 rounded-full border px-3 text-[12.5px] font-medium transition-colors", t.id === tab ? "border-primary bg-primary text-text-inverse" : "border-border bg-surface text-text-secondary hover:bg-surface-hover hover:text-text")}>
                {sourceName(t, answers)}
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <h3 className="text-[15px] font-semibold text-text">How to export from {sourceName(current, answers).toLowerCase() === "spreadsheets" ? "your spreadsheet" : sourceName(current, answers)}</h3>
            <ol className="mt-3 flex flex-col gap-2.5">
              {(current.export?.steps ?? []).map((step, i) => (
                <li key={`${current.id}-${i}`} className="flex gap-3 text-[13.5px] leading-5 text-text-secondary">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-subdued text-[12px] font-semibold text-text">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            {current.export?.note && <p className="mt-3 text-[12.5px] text-text-tertiary">{current.export.note}</p>}
            {current.export?.formats && <p className="mt-2 text-[12.5px] text-text-tertiary">Accepted: {current.export.formats}</p>}
            {current.integrationId && (
              <Button variant="plain" size="sm" icon={<Plug />} iconRight={<ArrowUpRight />} href={`/integrations?connect=${current.integrationId}`} className="mt-3">
                Connect {current.label} live instead
              </Button>
            )}
          </div>
          <DropTarget onFiles={acceptFiles} busy={busy} />
        </div>
      </Panel>
    );

  if (route === "paper")
    return (
      <Panel>
        <DocumentReader onSource={onDocument} hint={hint} incoming={incoming} prominent />
        <p className="mt-3 text-[12.5px] text-text-tertiary">
          <FileText className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
          Photos (.jpg, .png, .heic), .pdf, .xml, .json or .txt. Up to 12 pages per read; add every page of the same list before reading.
        </p>
      </Panel>
    );

  return (
    <Panel>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-text">
            {memory ? <Sparkles className="h-4 w-4 text-magic" /> : <ClipboardPaste className="h-4 w-4 text-text-secondary" />}
            {memory ? "Type or dictate a list" : "Paste from a spreadsheet"}
          </h3>
          <TextArea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={memory ? "Blue 3PDT footswitch, 320\n1/4 in. jack, mono, about 80\nEnclosure 125B, 40" : "sku\tname\tqty\tunitCost\nSW-3PDT-BLU\t3PDT footswitch, blue\t320\t2.35"} className="min-h-[200px] font-mono text-[12px]" spellCheck={false} />
          <div className="mt-2 flex justify-end">
            <Button icon={memory ? <Sparkles /> : <ClipboardPaste />} onClick={usePasted} disabled={!pasted.trim()}>
              {memory ? "Read with Strato" : "Use pasted data"}
            </Button>
          </div>
        </div>
        <div>
          <h3 className="mb-2 flex items-center gap-2 text-[15px] font-semibold text-text">
            <Globe className="h-4 w-4 text-text-secondary" />
            Read your website
          </h3>
          <p className="mb-3 text-[12.5px] text-text-secondary">Names, SKUs, prices and images come in; counts stay blank until you add them.</p>
          <WebsiteImport embedded onImported={onWebsiteImported} />
        </div>
      </div>
    </Panel>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <section className="float-in rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">{children}</section>;
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
      className={cn("flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-[var(--radius)] border border-dashed px-4 py-8 text-center transition-colors", dragging ? "border-accent bg-accent-soft" : "border-border-strong bg-surface-subdued hover:bg-surface-hover")}
    >
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface text-text-secondary shadow-[0_0_0_1px_var(--border)]">
        <UploadCloud className="h-5 w-5" />
      </span>
      <div className="text-[14px] font-medium text-text">{busy ? "Reading file…" : "Drop the file here, or tap to choose"}</div>
      <div className="mt-1 text-[12.5px] text-text-secondary">.xlsx, .csv, .tsv, .txt, .xml, .pdf or photos</div>
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
