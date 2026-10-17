"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { Camera, FileText, Images, Loader2, Sparkles, X } from "lucide-react";
import { Banner, Button, useToast } from "@/components/ui";
import { pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useStratoImportApi } from "./api";
import { fromTable } from "./parse";
import type { ParsedSource } from "./types";

/** Accepted by the picker: photos, PDFs and text-like files Strato can read. */
export const DOCUMENT_ACCEPT = "image/*,.pdf,application/pdf,.txt,.xml,.json,.md,text/plain,text/xml,application/xml,application/json";

export function isDocumentFile(file: Pick<File, "name" | "type">): boolean {
  return /^image\//.test(file.type) || /\.(jpe?g|png|webp|heic|heif|gif|pdf|xml|json|md)$/i.test(file.name) || file.type === "application/pdf" || /xml|json/.test(file.type);
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

export interface ReadMeta {
  documentType: string;
  confidence: number;
  files: number;
}

/** Longest edge of a photo sent to Strato; plenty for handwriting, small enough for a dozen pages per call. */
const MAX_EDGE = 1800;
/** A single PDF (or batch) past this is refused before upload; the function takes 4.5 MB. */
const MAX_BATCH_BYTES = 3_800_000;

const kindOf = (file: File): Queued["kind"] => (/^image\//.test(file.type) || /\.(jpe?g|png|webp|heic|heif|gif)$/i.test(file.name) ? "image" : file.type === "application/pdf" || /\.pdf$/i.test(file.name) ? "pdf" : "text");

/** Photos are re-encoded to a bounded JPEG so a 12-megapixel shot does not blow the request. */
async function shrinkImage(file: File): Promise<{ data: string; mediaType: string; bytes: number }> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    bitmap = null;
  }
  if (!bitmap) {
    // The browser could not decode it (HEIC on desktop, say): send it as is when it is small enough.
    if (file.size > 2_500_000) throw new Error(`${file.name} is too large to send as is. Export it as JPEG first.`);
    return { data: await toBase64(file), mediaType: file.type || "image/jpeg", bytes: file.size };
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
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return { data: base64, mediaType: "image/jpeg", bytes: Math.round(base64.length * 0.75) };
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

interface DocumentReaderProps {
  onSource: (source: ParsedSource, meta: ReadMeta) => void;
  /** A line about the business so Strato reads units and categories the right way. */
  hint?: string;
  /** Files handed over by another drop zone; each new array is appended once. */
  incoming?: File[] | null;
  /** Bigger targets and the camera first: the walkthrough on a phone. */
  prominent?: boolean;
  className?: string;
}

/**
 * Paper, whiteboards, PDFs and odd text files go through Strato: photos are
 * shrunk in the browser, everything is sent in one call, and the table that
 * comes back drops into the import wizard like any spreadsheet.
 */
export function DocumentReader({ onSource, hint, incoming, prominent, className }: DocumentReaderProps) {
  const api = useStratoImportApi();
  const toast = useToast();
  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<Queued[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toQueued = (file: File): Queued => {
    const kind = kindOf(file);
    return { id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`, file, kind, preview: kind === "image" ? URL.createObjectURL(file) : undefined };
  };
  const add = (files: FileList | File[] | null | undefined) => {
    if (!files) return;
    const next: Queued[] = [];
    for (const file of Array.from(files)) {
      if (!isDocumentFile(file) && kindOf(file) !== "text") {
        toast(`${file.name}: photos, PDFs, text or XML only.`, "critical");
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
      const files: Array<{ name: string; mediaType: string; data?: string; text?: string }> = [];
      let total = 0;
      for (const q of queue) {
        if (q.kind === "image") {
          const shrunk = await shrinkImage(q.file);
          total += shrunk.bytes;
          files.push({ name: q.file.name, mediaType: shrunk.mediaType, data: shrunk.data });
        } else if (q.kind === "pdf") {
          total += q.file.size;
          files.push({ name: q.file.name, mediaType: "application/pdf", data: await toBase64(q.file) });
        } else {
          const text = await q.file.text();
          total += text.length;
          files.push({ name: q.file.name, mediaType: q.file.type || "text/plain", text });
        }
      }
      if (total > MAX_BATCH_BYTES) throw new Error("That is more than Strato takes in one go. Send fewer pages at a time, or a smaller PDF.");
      setBusy(queue.some((q) => q.kind === "image") ? "Strato is reading the pages…" : "Strato is reading the file…");
      const out = await api<ExtractResponse>("/api/import/extract", { files, hint });
      if (out.headers.length === 0 || out.rows.length === 0) throw new Error(out.warnings[0] ?? "Strato could not find an item list in that. Try a clearer photo or a different page.");
      const name = queue.length === 1 ? queue[0]!.file.name : `${pluralize(queue.length, "document")} read by Strato`;
      const source = fromTable(name, [out.headers, ...out.rows]);
      const warnings = [...source.warnings, ...out.warnings];
      if (out.confidence < 0.6) warnings.unshift("The source was hard to read; check the numbers before importing.");
      onSource({ ...source, warnings }, { documentType: out.documentType, confidence: out.confidence, files: queue.length });
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
        <div className="text-[13.5px] font-medium text-text">Photos of paper, PDFs, XML or plain text</div>
        <div className="mt-1 text-[12.5px] text-text-secondary">Strato reads names, codes, counts and prices into a table you check before anything is imported.</div>
        <div className={cn("mt-4 flex flex-wrap items-center justify-center gap-2", prominent && "flex-col sm:flex-row")}>
          <Button size={prominent ? "lg" : "md"} variant={prominent ? "primary" : "secondary"} icon={<Camera />} onClick={() => cameraRef.current?.click()} disabled={!!busy} fullWidth={prominent} className={prominent ? "sm:w-auto" : undefined}>
            Take a photo
          </Button>
          <Button size={prominent ? "lg" : "md"} icon={<Images />} onClick={() => pickRef.current?.click()} disabled={!!busy} fullWidth={prominent} className={prominent ? "sm:w-auto" : undefined}>
            Choose files
          </Button>
        </div>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={pickRef}
          type="file"
          accept={DOCUMENT_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
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
            <span className="text-[12.5px] text-text-secondary">{busy ?? `${pluralize(queue.length, "file")} ready. Add every page of the same list before reading.`}</span>
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
