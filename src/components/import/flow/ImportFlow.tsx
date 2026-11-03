"use client";

import { Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, Boxes, ClipboardPaste, Contact, FileSpreadsheet, Globe, NotebookPen, Plug, Sparkles, Truck, UploadCloud } from "lucide-react";
import { Badge, Banner, Button, Page, QueryParamEffect, TextArea, useToast } from "@/components/ui";
import { useAgent } from "@/components/agent/AgentProvider";
import { FadeSwap, TypedText } from "@/components/onboarding/StepFrame";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { describeAnswers } from "@/lib/onboarding";
import { SPREADSHEET_ACCEPT, isSpreadsheetFile } from "@/lib/spreadsheet";
import { useSettings } from "@/lib/store/provider";
import { cn } from "@/lib/utils";
import { DOCUMENT_ACCEPT, DocumentReader, isDocumentFile, type ReadMeta, type ReadTarget } from "../DocumentReader";
import { ImportWizard } from "../ImportWizard";
import { parseFile, parsePasted } from "../parse";
import type { ParsedSource, WizardStep } from "../types";
import { WebsiteImport } from "../WebsiteImport";
import { RecordImport, type RecordStage } from "./RecordImport";

type Kind = ReadTarget;
type Route = "file" | "documents" | "paste" | "website";
type Screen = "kind" | "route" | "source" | "map" | "review" | "done";

const KINDS: Array<{ id: Kind; icon: ReactNode; title: string; description: string; points: string[] }> = [
  { id: "items", icon: <Boxes />, title: "Items and stock", description: "Parts, products, assemblies: SKUs, names, counts, costs, prices, bins.", points: ["Matched by SKU; existing items update", "Strato fills blanks on the review step", "Counts go through the stock ledger"] },
  { id: "customers", icon: <Contact />, title: "Customers", description: "People and companies you sell to, with emails, phones and addresses.", points: ["Matched by email, then name", "First and last name columns join", "Contact exports and vCards read as is"] },
  { id: "suppliers", icon: <Truck />, title: "Suppliers", description: "Vendors and manufacturers, with contacts, lead times and terms.", points: ["Matched by name", "Lead times feed replenishment", "Link items to them afterwards"] },
];

const ROUTES: Array<{ id: Route; icon: ReactNode; title: string; description: string; points: string[]; kinds: Kind[]; badge?: ReactNode }> = [
  { id: "file", icon: <FileSpreadsheet />, title: "A spreadsheet or export", description: "Excel, CSV, Numbers, Google Sheets, or an export from a store, POS or accounting app.", points: ["Columns matched for you", "Shopify, WooCommerce, Square, Clover, QuickBooks exports recognized", "Anything that is not a table goes to Strato"], kinds: ["items", "customers", "suppliers"] },
  { id: "documents", icon: <NotebookPen />, title: "Paper, photos, PDFs, any file", description: "Photograph a sheet, or drop a PDF, text, XML or vCard. Strato reads it into a table you check first.", points: ["Phone camera, straight from the shelf", "Plain-text exports and vCards read instantly", "Several files at once, read in parallel"], kinds: ["items", "customers", "suppliers"], badge: <Badge tone="magic">Strato</Badge> },
  { id: "paste", icon: <ClipboardPaste />, title: "Paste it", description: "Copy cells from a spreadsheet, header row included, or type a plain list.", points: ["Cells go straight to matching", "A one-per-line list is read by Strato", "Nothing to save first"], kinds: ["items", "customers", "suppliers"] },
  { id: "website", icon: <Globe />, title: "Read your website", description: "A Shopify, WooCommerce or plain product site: names, SKUs, prices and images come in.", points: ["Counts and costs stay blank", "Connect the store later for live sync", "Hosted workspaces only"], kinds: ["items"] },
];

const SCREENS: Array<{ id: Screen; label: string }> = [
  { id: "kind", label: "What" },
  { id: "route", label: "How" },
  { id: "source", label: "Bring it in" },
  { id: "map", label: "Match" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
];

const FILE_ACCEPT = `.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain,${SPREADSHEET_ACCEPT},${DOCUMENT_ACCEPT}`;

const kindLabel = (k: Kind) => KINDS.find((x) => x.id === k)!.title;

/**
 * The Import page as a short walk: what you are importing, how it arrives,
 * the file or photos themselves, then match, review and done. Every file
 * type is welcome on every path; what is not already a table is read by
 * Strato.
 */
export function ImportFlow() {
  const { setPageContext } = useAgent();
  const user = useCurrentUser();
  const settings = useSettings();
  const toast = useToast();
  const [kind, setKind] = useState<Kind | null>(null);
  const [route, setRoute] = useState<Route | null>(null);
  const [source, setSource] = useState<{ parsed: ParsedSource; nonce: number } | null>(null);
  const [handoff, setHandoff] = useState<File[] | null>(null);
  const [inner, setInner] = useState<Screen>("map");
  const [onboarding, setOnboarding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pasted, setPasted] = useState("");
  const [websiteDone, setWebsiteDone] = useState<{ created: number; updated: number } | null>(null);
  const hint = describeAnswers(settings.onboarding);

  useEffect(() => {
    setPageContext({ page: "Import" });
  }, [setPageContext]);
  const onKindParam = useCallback((v: string) => {
    const k = KINDS.find((x) => x.id === v)?.id;
    if (k) setKind(k);
  }, []);

  const screen: Screen = !kind ? "kind" : !route ? "route" : !source ? (websiteDone ? "done" : "source") : inner;
  const screenIndex = SCREENS.findIndex((s) => s.id === screen);
  const swapKey = screen === "source" || screen === "route" ? `${screen}-${route ?? kind}` : source ? `${screen}-${source.nonce}` : screen;

  const reset = () => {
    setKind(null);
    setRoute(null);
    setSource(null);
    setHandoff(null);
    setInner("map");
    setPasted("");
    setWebsiteDone(null);
  };
  const takeSource = (parsed: ParsedSource) => {
    setSource({ parsed, nonce: Date.now() });
    setInner("map");
  };
  const toDocuments = (files: File[]) => {
    setHandoff(files);
    setRoute("documents");
  };

  const acceptFiles = async (files: FileList | File[] | null | undefined) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    const docs = list.filter((f) => isDocumentFile(f) && !isSpreadsheetFile(f) && !/\.(csv|tsv)$/i.test(f.name));
    const table = list.find((f) => !docs.includes(f));
    if (docs.length) toDocuments(docs);
    if (!table) return;
    setBusy(true);
    try {
      const parsed = await parseFile(table);
      if (parsed.headers.length === 0) {
        toast("No header row found in that file.", "critical");
        return;
      }
      takeSource(parsed);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not read that file.", "critical");
    } finally {
      setBusy(false);
    }
  };

  const usePasted = () => {
    const parsed = parsePasted(pasted);
    if (parsed.headers.length < 2 || parsed.rows.length === 0) {
      toDocuments([new File([pasted], "Pasted list.txt", { type: "text/plain" })]);
      return;
    }
    takeSource(parsed);
  };

  const onDocument = (parsed: ParsedSource, meta: ReadMeta) => {
    toast(meta.modelReads === 0 ? `Read ${parsed.rows.length} rows on the spot` : `Strato read ${parsed.rows.length} rows`, "success");
    takeSource(parsed);
  };

  // The item wizard's own steps (2 map, 3 review, 4 done) and the record importer's stages drive the header.
  const onWizardStep = useCallback((s: WizardStep) => {
    if (s === 1) setSource(null);
    else setInner(s === 2 ? "map" : s === 3 ? "review" : "done");
  }, []);
  const onRecordStage = useCallback((s: RecordStage) => setInner(s), []);

  const heading = ((): { lead: string; title: string; subtitle?: string } => {
    switch (screen) {
      case "kind":
        return { lead: "Let's bring something in.", title: "What are you importing?" };
      case "route":
        return { lead: `${kindLabel(kind!)}. Got it.`, title: "How does it arrive?" };
      case "source": {
        const r = ROUTES.find((x) => x.id === route)!;
        return { lead: r.id === "documents" ? "Strato will do the reading." : r.id === "website" ? "The catalog comes to you." : "Drop it in.", title: r.title, subtitle: r.description };
      }
      case "map":
        return { lead: "Nearly there.", title: "Match the columns", subtitle: `Each column becomes a field. Most are matched already; fix any that are wrong${kind === "items" ? ", or let Strato map them" : ""}.` };
      case "review":
        return { lead: "One last look.", title: "Check before it saves", subtitle: "New records, updates and anything that needs attention, row by row." };
      case "done":
        return { lead: "That's it.", title: `${kindLabel(kind ?? "items")} are in` };
    }
  })();

  const back = () => {
    if (screen === "route") setKind(null);
    else if (screen === "source") {
      setRoute(null);
      setHandoff(null);
      setWebsiteDone(null);
    }
  };

  return (
    <Page
      title="Import"
      subtitle="Items, customers or suppliers, from a file, a photo, a paste or your website"
      secondaryActions={
        <Button icon={<Plug />} href="/integrations">
          Integrations
        </Button>
      }
    >
      <Suspense fallback={null}>
        <QueryParamEffect param="onboarding" onValue={() => setOnboarding(true)} />
        <QueryParamEffect param="kind" onValue={onKindParam} />
      </Suspense>
      {onboarding && (
        <Banner tone="info" title="Prefer the guided setup?" action={<Button href="/onboarding">Open it</Button>}>
          It asks what you use today and walks through the same steps with more hand-holding.
        </Banner>
      )}
      {!canWrite(user) && (
        <Banner tone="warning" title="You have view-only access">
          You can walk through and preview the mapping, but importing needs a member, admin or owner role.
        </Banner>
      )}

      <Steps current={screenIndex} />

      <FadeSwap
        id={swapKey}
        // The importers keep their state from match to review to done, so they live in the stable slot; only the heading swaps.
        stable={source ? kind === "items" ? <ItemsStage key={source.nonce} source={source.parsed} onStep={onWizardStep} onRestart={reset} kind={kind} /> : <RecordImport key={source.nonce} kind={kind as "customers" | "suppliers"} source={source.parsed} onStage={onRecordStage} onBack={() => setSource(null)} onRestart={reset} /> : undefined}
      >
        <div className="mb-5">
          <TypedText as="p" text={heading.lead} speed={12} className="min-h-[20px] text-[13.5px] font-medium text-text-secondary" />
          <h2 className="text-[22px] font-semibold leading-7 tracking-[-0.01em] text-text">{heading.title}</h2>
          {heading.subtitle && <p className="mt-1 max-w-[640px] text-[13.5px] leading-5 text-text-secondary">{heading.subtitle}</p>}
        </div>

        {screen === "kind" && <PickCards options={KINDS} onPick={(id) => setKind(id as Kind)} />}

        {screen === "route" && (
          <>
            <PickCards options={ROUTES.filter((r) => r.kinds.includes(kind!))} onPick={(id) => setRoute(id as Route)} />
            <div className="mt-6">
              <Button icon={<ArrowLeft />} onClick={back}>
                Back
              </Button>
            </div>
          </>
        )}

        {screen === "source" && (
          <>
            <Panel>
              {route === "file" && <DropTarget onFiles={acceptFiles} busy={busy} />}
              {route === "documents" && <DocumentReader target={kind!} onSource={onDocument} hint={hint} incoming={handoff} prominent />}
              {route === "paste" && (
                <>
                  <TextArea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={kind === "items" ? "sku\tname\tqty\tunitCost\nSW-3PDT-BLU\t3PDT footswitch, blue\t320\t2.35" : kind === "customers" ? "name\temail\tphone\nJane Alvarez\tjane@example.com\t704 555 0100" : "supplier\temail\tlead time\nMouser Electronics\torders@mouser.example\t5"} className="min-h-[200px] font-mono text-[12px]" spellCheck={false} />
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-[12.5px] text-text-secondary">Cells with a header row go straight to matching; a plain list is read by Strato.</span>
                    <Button variant="primary" icon={<ClipboardPaste />} onClick={usePasted} disabled={!pasted.trim()}>
                      Use pasted data
                    </Button>
                  </div>
                </>
              )}
              {route === "website" && <WebsiteImport embedded onImported={(r) => setWebsiteDone(r)} />}
            </Panel>
            <div className="mt-6 flex items-center justify-between">
              <Button icon={<ArrowLeft />} onClick={back}>
                Back
              </Button>
              {route !== "website" && route !== "documents" && (
                <Button variant="plain" icon={<Sparkles />} onClick={() => setRoute("documents")}>
                  Not a table? Let Strato read it
                </Button>
              )}
            </div>
          </>
        )}

        {screen === "done" && websiteDone && (
          <Panel>
            <p className="text-[13.5px] text-text">
              <span className="font-medium">{websiteDone.created} added, {websiteDone.updated} updated</span> from your website. Counts and costs are blank until you set them or connect the store.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" href="/inventory">
                Open inventory
              </Button>
              <Button onClick={reset}>Import something else</Button>
            </div>
          </Panel>
        )}

      </FadeSwap>
    </Page>
  );
}

/** The item wizard, kept mounted across match → review → done. */
function ItemsStage({ source, onStep, onRestart }: { source: ParsedSource; onStep: (s: WizardStep) => void; onRestart: () => void; kind: Kind }) {
  return (
    <ImportWizard
      initialSource={source}
      hideStepper
      onStepChange={onStep}
      doneActions={
        <>
          <Button variant="primary" icon={<Boxes />} href="/inventory">
            View inventory
          </Button>
          <Button onClick={onRestart}>Import something else</Button>
        </>
      }
    />
  );
}

function Steps({ current }: { current: number }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <ol className="flex flex-wrap items-center gap-1.5" aria-label="Import progress">
        {SCREENS.map((s, i) => (
          <li key={s.id} className={cn("rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors", i === current ? "bg-primary text-text-inverse" : i < current ? "bg-surface-selected text-text" : "text-text-tertiary")} aria-current={i === current ? "step" : undefined}>
            {s.label}
          </li>
        ))}
      </ol>
      <span className="hidden h-1.5 min-w-[120px] flex-1 overflow-hidden rounded-full bg-border sm:block">
        <span className="setup-progress block h-full rounded-full bg-primary" style={{ width: `${Math.round(((current + 1) / SCREENS.length) * 100)}%` }} />
      </span>
    </div>
  );
}

function PickCards({ options, onPick }: { options: Array<{ id: string; icon: ReactNode; title: string; description: string; points: string[]; badge?: ReactNode }>; onPick: (id: string) => void }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {options.map((o, i) => (
        <button key={o.id} type="button" onClick={() => onPick(o.id)} style={{ animationDelay: `${i * 90}ms` }} className="float-in group flex min-h-[240px] flex-col items-start rounded-[var(--radius-lg)] border border-border bg-surface p-5 text-left shadow-[var(--shadow-card)] transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-border-strong focus-visible:border-accent focus-visible:outline-none">
          <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-surface-subdued text-text-secondary [&>svg]:h-5 [&>svg]:w-5">{o.icon}</span>
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[16px] font-semibold leading-6 text-text">{o.title}</span>
            {o.badge}
          </span>
          <span className="mt-1 block text-[13px] leading-5 text-text-secondary">{o.description}</span>
          <ul className="mt-3 flex flex-col gap-1">
            {o.points.map((pt) => (
              <li key={pt} className="flex gap-2 text-[12.5px] leading-5 text-text">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-text-tertiary" />
                {pt}
              </li>
            ))}
          </ul>
          <span className="mt-auto inline-flex items-center gap-1 pt-4 text-[13px] font-medium text-accent group-hover:underline">
            Choose <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </button>
      ))}
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <section className="float-in rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-[var(--shadow-card)]">{children}</section>;
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
      <div className="mt-1 text-[12.5px] text-text-secondary">Any file: .xlsx, .csv, .tsv, .txt, .xml, .json, .vcf, .pdf or photos</div>
      <input ref={inputRef} type="file" multiple accept={FILE_ACCEPT} className="hidden" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
    </div>
  );
}
