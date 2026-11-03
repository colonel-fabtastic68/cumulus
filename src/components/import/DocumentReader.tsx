"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { Camera, FileText, Images, Loader2, Sparkles, X } from "lucide-react";
import { Banner, Button, useToast } from "@/components/ui";
import { pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useStratoImportApi } from "./api";
import { fromTable, parsePasted } from "./parse";
import type { ParsedSource } from "./types";

export type ReadTarget = "items" | "customers" | "suppliers";

/** Accepted by the picker: photos, PDFs and text-like files Strato can read. */
export const DOCUMENT_ACCEPT = "image/*,.pdf,application/pdf,.txt,.xml,.json,.md,.vcf,.csv,.tsv,text/plain,text/xml,application/xml,application/json,text/vcard,text/csv";

export function isDocumentFile(file: Pick<File, "name" | "type">): boolean {
  return /^image\//.test(file.type) || /\.(jpe?g|png|webp|heic|heif|gif|pdf|xml|json|md|txt|vcf|csv|tsv)$/i.test(file.name) || file.type === "application/pdf" || /xml|json|vcard|text\//.test(file.type);
}

interface Queued {
  id: string;
  file: File;
  kind: "image" | "pdf" | "text";
  /** Object URL for the thumbnail of a photo. */
  preview?: string;
}

interface ExtractResponse {
  documentType: string;
  headers: string[];
  rows: string[][];
  warnings: string[];
  confidence: number;
}

/** A table from one file, whether Strato or the local parser produced it. */
interface Table {
  name: string;
  headers: string[];
  rows: string[][];
  warnings: string[];
  confidence: number;
  documentType: string;
}

export interface ReadMeta {
  documentType: string;
  confidence: number;
  files: number;
  /** How many files needed Strato (the rest were read locally). */
  modelReads: number;
}

/** Longest edge of a photo sent to Strato; plenty for handwriting, small enough for a dozen pages per call. */
const MAX_EDGE = 1800;
/** A single PDF past this is refused before upload; the function takes 4.5 MB. */
const MAX_FILE_BYTES = 3_800_000;
/** Files read by Strato at once. */
const CONCURRENCY = 3;

const TARGET_COPY: Record<ReadTarget, { title: string; body: string }> = {
  items: { title: "Photos of paper, PDFs, XML or plain text", body: "Strato reads names, codes, counts and prices into a table you check before anything is imported." },
  customers: { title: "Contact lists, exports, business cards, PDFs", body: "Strato reads names, companies, emails, phones and addresses into a table you check before anything is imported. Plain text exports and vCards are read on the spot." },
  suppliers: { title: "Vendor lists, exports, PDFs", body: "Strato reads supplier names, contacts, emails, phones and lead times into a table you check before anything is imported." },
};

const kindOf = (file: File): Queued["kind"] => (/^image\//.test(file.type) || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.name) ? "image" : file.type === "application/pdf" || /\.pdf$/i.test(file.name) ? "pdf" : "text");

const toQueued = (file: File): Queued => {
  const kind = kindOf(file);
  return { id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`, file, kind, preview: kind === "image" ? URL.createObjectURL(file) : undefined };
};

/** Photos are re-encoded to a bounded JPEG so a 12-megapixel shot does not blow the request. */
async function shrinkImage(file: File): Promise<{ data: string; mediaType: string }> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    bitmap = null;
  }
  if (!bitmap) {
    if (file.size > 2_500_000) throw new Error(`${file.name} is too large to send as is. Export it as JPEG first.`);
    return { data: await toBase64(file), mediaType: file.type || "image/jpeg" };
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot resize photos.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { data: dataUrl.slice(dataUrl.indexOf(",") + 1), mediaType: "image/jpeg" };
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

/** vCard exports (phones, Outlook, Google Contacts) read locally: no model call. */
function parseVcards(text: string): Table | null {
  if (!/BEGIN:VCARD/i.test(text)) return null;
  const cards = text.replace(/\r\n[ \t]/g, "").split(/BEGIN:VCARD/i).slice(1);
  const headers = ["name", "company", "email", "phone", "street1", "city", "state", "zip", "country", "notes"];
  const rows: string[][] = [];
  for (const card of cards) {
    const get = (key: string) => {
      const m = new RegExp(`^${key}(?:;[^:]*)?:(.*)$`, "im").exec(card);
      return m ? m[1]!.trim() : "";
    };
    const n = get("N").split(";");
    const name = get("FN") || [n[1], n[0]].filter(Boolean).join(" ").trim();
    const adr = get("ADR").split(";");
    const row = [name, get("ORG").split(";")[0] ?? "", get("EMAIL").toLowerCase(), get("TEL"), [adr[1], adr[2]].filter(Boolean).join(" "), adr[3] ?? "", adr[4] ?? "", adr[5] ?? "", adr[6] ?? "", get("NOTE")].map((v) => v.replace(/\\,/g, ",").replace(/\\n/g, " ").trim());
    if (row.some(Boolean)) rows.push(row);
  }
  return rows.length ? { name: "vCard", headers, rows, warnings: [], confidence: 1, documentType: "vCard contacts" } : null;
}

/** Delimited text (CSV, TSV, semicolons) read locally when it already is a table. */
function parseDelimited(name: string, text: string): Table | null {
  const parsed = parsePasted(text);
  if (parsed.headers.length < 2 || parsed.rows.length === 0) return null;
  // A real table fills most of its columns on most rows; prose or a one-per-line list does not.
  const filled = parsed.rows.filter((r) => parsed.headers.filter((h) => r[h]).length >= Math.max(2, Math.ceil(parsed.headers.length * 0.5))).length;
  if (filled < parsed.rows.length * 0.6) return null;
  return { name, headers: parsed.headers, rows: parsed.rows.map((r) => parsed.headers.map((h) => r[h] ?? "")), warnings: parsed.warnings, confidence: 1, documentType: "delimited text" };
}

/** Tables from several files become one: columns united by name, rows in file order. */
function mergeTables(tables: Table[]): Table {
  const headers: string[] = [];
  for (const t of tables) for (const h of t.headers) if (!headers.some((x) => x.toLowerCase() === h.toLowerCase())) headers.push(h);
  const idx = (t: Table, h: string) => t.headers.findIndex((x) => x.toLowerCase() === h.toLowerCase());
  const rows = tables.flatMap((t) => t.rows.map((r) => headers.map((h) => r[idx(t, h)] ?? "")));
  return { name: tables.length === 1 ? tables[0]!.name : `${pluralize(tables.length, "document")}`, headers, rows, warnings: tables.flatMap((t) => t.warnings.map((w) => (tables.length > 1 ? `${t.name}: ${w}` : w))), confidence: Math.min(...tables.map((t) => t.confidence)), documentType: tables[0]!.documentType };
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!, i);
      }
    }),
  );
  return out;
}

interface DocumentReaderProps {
  onSource: (source: ParsedSource, meta: ReadMeta) => void;
  /** What the rows are for: picks the column vocabulary Strato uses. */
  target?: ReadTarget;
  /** A line about the business so Strato reads units and categories the right way. */
  hint?: string;
  /** Files handed over by another drop zone; each new array is appended once. */
  incoming?: File[] | null;
  /** Bigger targets and the camera first. */
  prominent?: boolean;
  className?: string;
}

/**
 * Paper, whiteboards, PDFs, exports and odd text files become a table. Text
 * that already is a table (CSV, vCard) is read in the browser at once; the
 * rest goes to Strato, one request per file in parallel, and the tables are
 * merged. The result drops into the import flow like any spreadsheet.
 */
export function DocumentReader({ onSource, target = "items", hint, incoming, prominent, className }: DocumentReaderProps) {
  const api = useStratoImportApi();
  const toast = useToast();
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  // Files handed over by another screen are queued from the start; later hand-offs are appended below.
  const [queue, setQueue] = useState<Queued[]>(() => (incoming?.length ? incoming.map(toQueued) : []));
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copy = TARGET_COPY[target];

  const add = (files: FileList | File[] | null | undefined) => {
    if (!files) return;
    const next: Queued[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE_BYTES && kindOf(file) !== "image") {
        toast(`${file.name} is over 3.8 MB. Split it or export a smaller file.`, "critical");
        continue;
      }
      next.push(toQueued(file));
    }
    if (next.length) {
      setQueue((q) => [...q, ...next].slice(0, 12));
      setError(null);
    }
  };

  // Files handed over by another drop zone are queued as they arrive (state derived from the prop, no effect needed).
  const [seenIncoming, setSeenIncoming] = useState<File[] | null | undefined>(incoming);
  if (incoming !== seenIncoming) {
    setSeenIncoming(incoming);
    if (incoming?.length) {
      setQueue((q) => [...q, ...incoming.map(toQueued)].slice(0, 12));
      setError(null);
    }
  }
  useEffect(() => () => queue.forEach((q) => q.preview && URL.revokeObjectURL(q.preview)), [queue]);

  const remove = (id: string) => setQueue((q) => q.filter((x) => x.id !== id));

  const read = async () => {
    if (queue.length === 0) return;
    setError(null);
    try {
      setBusy("Preparing files…");
      const local: Table[] = [];
      const remote: Array<{ q: Queued; payload: { name: string; mediaType: string; data?: string; text?: string } }> = [];
      for (const q of queue) {
        if (q.kind === "text") {
          const text = await q.file.text();
          const table = parseVcards(text) ?? parseDelimited(q.file.name, text);
          if (table) local.push({ ...table, name: q.file.name });
          else remote.push({ q, payload: { name: q.file.name, mediaType: q.file.type || "text/plain", text } });
        } else if (q.kind === "pdf") remote.push({ q, payload: { name: q.file.name, mediaType: "application/pdf", data: await toBase64(q.file) } });
        else {
          const shrunk = await shrinkImage(q.file);
          remote.push({ q, payload: { name: q.file.name, mediaType: shrunk.mediaType, data: shrunk.data } });
        }
      }
      // Photos of the same list are one document and go together; everything else is its own request so they run side by side.
      const photos = remote.filter((r) => r.q.kind === "image");
      const others = remote.filter((r) => r.q.kind !== "image");
      const jobs: Array<Array<(typeof remote)[number]>> = [...(photos.length ? [photos] : []), ...others.map((o) => [o])];
      let done = 0;
      const fromModel = await pool(jobs, CONCURRENCY, async (job) => {
        setBusy(jobs.length > 1 ? `Strato is reading ${done + 1} of ${jobs.length}…` : job[0]!.q.kind === "image" ? "Strato is reading the pages…" : "Strato is reading the file…");
        const out = await api<ExtractResponse>("/api/import/extract", { files: job.map((j) => j.payload), hint, target });
        done++;
        setBusy(jobs.length > 1 ? `Strato read ${done} of ${jobs.length}…` : null);
        return { ...out, name: job.length === 1 ? job[0]!.q.file.name : pluralize(job.length, "photo") } as Table;
      });
      const tables = [...local, ...fromModel.filter((t) => t.headers.length && t.rows.length)];
      if (tables.length === 0) throw new Error(fromModel[0]?.warnings[0] ?? "Strato could not find a list in that. Try a clearer photo or a different file.");
      const merged = mergeTables(tables);
      const source = fromTable(merged.name, [merged.headers, ...merged.rows]);
      const warnings = [...source.warnings, ...merged.warnings];
      if (merged.confidence < 0.6) warnings.unshift("The source was hard to read; check the values before importing.");
      onSource({ ...source, warnings }, { documentType: merged.documentType, confidence: merged.confidence, files: queue.length, modelReads: jobs.length });
      setQueue([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    add(e.dataTransfer.files);
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn("rounded-[var(--radius)] border border-dashed px-4 text-center transition-colors", prominent ? "py-8" : "py-6", dragging ? "border-accent bg-accent-soft" : "border-border-strong bg-surface-subdued")}
      >
        <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface text-magic shadow-[0_0_0_1px_var(--border)]">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="text-[13.5px] font-medium text-text">{copy.title}</div>
        <div className="mt-1 text-[12.5px] text-text-secondary">{copy.body}</div>
        <div className={cn("mt-4 flex flex-wrap items-center justify-center gap-2", prominent && "flex-col sm:flex-row")}>
          <Button size={prominent ? "lg" : "md"} variant={prominent ? "primary" : "secondary"} icon={<Camera />} onClick={() => cameraRef.current?.click()} disabled={!!busy} fullWidth={prominent} className={prominent ? "sm:w-auto" : undefined}>
            Take a photo
          </Button>
          <Button size={prominent ? "lg" : "md"} icon={<Images />} onClick={() => pickRef.current?.click()} disabled={!!busy} fullWidth={prominent} className={prominent ? "sm:w-auto" : undefined}>
            Choose files
          </Button>
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <input ref={pickRef} type="file" accept={DOCUMENT_ACCEPT} multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>

      {queue.length > 0 && (
        <div className="flex flex-col gap-3">
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {queue.map((q) => (
              <li key={q.id} className="group relative aspect-square overflow-hidden rounded-[var(--radius-sm)] border border-border bg-surface">
                {q.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={q.preview} alt={q.file.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center text-text-secondary">
                    <FileText className="h-5 w-5" />
                    <span className="line-clamp-2 text-[11px] leading-tight">{q.file.name}</span>
                  </div>
                )}
                <button type="button" onClick={() => remove(q.id)} aria-label={`Remove ${q.file.name}`} disabled={!!busy} className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80">
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12.5px] text-text-secondary">{busy ?? `${pluralize(queue.length, "file")} ready.${queue.some((q) => q.kind === "image") ? " Add every page of the same list before reading." : ""}`}</span>
            <div className="flex items-center gap-2">
              <Button variant="plain" size="sm" onClick={() => setQueue([])} disabled={!!busy}>
                Clear
              </Button>
              <Button variant="primary" icon={busy ? <Loader2 className="animate-spin" /> : <Sparkles />} onClick={() => void read()} loading={!!busy} disabled={!!busy}>
                Read with Strato
              </Button>
            </div>
          </div>
        </div>
      )}
      {error && (
        <Banner tone="critical" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
    </div>
  );
}
