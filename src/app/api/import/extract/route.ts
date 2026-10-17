import type { FilePart, ModelMessage, TextPart } from "ai";
import { z } from "zod";
import { HttpError, jsonError, readJson } from "@/lib/integrations/server";
import { GeminiUnavailable, geminiConfigured, structured } from "@/lib/gemini";
import { authenticateForStrato } from "@/lib/server/stratoAuth";

export const maxDuration = 120;

/** Vercel functions take 4.5 MB bodies; photos are shrunk in the browser before they get here. */
const MAX_TOTAL_BYTES = 4_000_000;
const MAX_FILES = 12;
const MAX_TEXT_CHARS = 200_000;

const IMAGE_TYPES = /^image\/(jpeg|png|webp|heic|heif|gif)$/;
const TEXT_TYPES = /^(text\/.*|application\/(xml|json|rtf))$/;

interface IncomingFile {
  name?: unknown;
  mediaType?: unknown;
  /** Base64 for images and PDFs; the text itself for text files. */
  data?: unknown;
  text?: unknown;
}

const schema = z.object({
  /** What the documents are, in a few words ("handwritten count sheet", "supplier price list PDF"). */
  documentType: z.string(),
  /** Column names for the table, in the order the rows use. Prefer cumulusOS field names when a column clearly means one: sku, name, description, category, unit, qty, unitCost, price, minQty, maxQty, location, barcode, supplierName, brand, tags. */
  headers: z.array(z.string()),
  /** One array per item, aligned with headers. Empty string when a cell is unknown. */
  rows: z.array(z.array(z.string())),
  /** Anything the person should check: unreadable cells, guessed digits, pages that were not a list. */
  warnings: z.array(z.string()),
  /** 0–1: how legible the source was. */
  confidence: z.number().min(0).max(1),
});

export type ExtractResult = z.infer<typeof schema>;

const SYSTEM = `You are Strato, the inventory assistant in cumulusOS. People send you photos of paper documents, PDFs, plain text and XML that list inventory items, and you turn them into one clean table ready to import.

Rules:
- Every physical line item becomes one row. Keep the order of the source.
- Read handwriting and printed text carefully; when a digit or letter is ambiguous, pick the most likely reading and mention it in warnings with the row number.
- Headers: use these cumulusOS field names whenever a column clearly means one: sku (part number / item code), name, description, category, unit (ea, kg, m, box…), qty (count on hand), unitCost (what is paid), price (what it sells for), minQty (reorder point / par), maxQty, location (bin, shelf, room), barcode (UPC/EAN), supplierName, brand, tags. Keep any other column under its own short label.
- Never invent values. Leave a cell empty when the source does not show it. Do not make up SKUs; the import can fill those in later.
- Numbers: plain digits with a decimal point, no currency symbols or units in numeric cells (put the unit in the unit column).
- Several pages of the same list are one table; a page that is not an item list (a cover, a receipt total, a photo of a shelf without text) is skipped and noted in warnings.
- Structured text (XML, JSON, delimited text): map each record to a row with the same header rules.`;

function decodeBase64(data: string): Buffer {
  const comma = data.indexOf(",");
  return Buffer.from(comma >= 0 && data.startsWith("data:") ? data.slice(comma + 1) : data, "base64");
}

/** Reads photos, PDFs, text and XML into a table of item rows. Nothing is written; the browser hands the table to the import wizard. */
export async function POST(req: Request) {
  try {
    await authenticateForStrato(req);
    if (!geminiConfigured()) throw new GeminiUnavailable("Strato needs a Gemini key (GOOGLE_GENERATIVE_AI_API_KEY) to read documents.");
    const body = await readJson<{ files?: unknown; hint?: unknown }>(req);
    const files = Array.isArray(body.files) ? (body.files as IncomingFile[]) : [];
    if (files.length === 0) throw new HttpError(400, "Attach a photo, PDF or text file.");
    if (files.length > MAX_FILES) throw new HttpError(400, `Up to ${MAX_FILES} files at a time.`);
    const hint = typeof body.hint === "string" ? body.hint.slice(0, 600) : "";

    const content: Array<TextPart | FilePart> = [];
    let total = 0;
    const names: string[] = [];
    for (const f of files) {
      const name = typeof f.name === "string" ? f.name.slice(0, 120) : "file";
      const mediaType = typeof f.mediaType === "string" ? f.mediaType.toLowerCase() : "";
      names.push(name);
      if (typeof f.text === "string") {
        const text = f.text.slice(0, MAX_TEXT_CHARS);
        total += text.length;
        content.push({ type: "text", text: `--- ${name} (${mediaType || "text"}) ---\n${text}\n--- end of ${name} ---` });
        continue;
      }
      if (typeof f.data !== "string" || !f.data) throw new HttpError(400, `${name} is empty.`);
      if (!IMAGE_TYPES.test(mediaType) && mediaType !== "application/pdf" && !TEXT_TYPES.test(mediaType)) throw new HttpError(400, `${name}: send photos, PDFs, text or XML.`);
      const bytes = decodeBase64(f.data);
      total += bytes.byteLength;
      if (TEXT_TYPES.test(mediaType)) {
        content.push({ type: "text", text: `--- ${name} (${mediaType}) ---\n${bytes.toString("utf8").slice(0, MAX_TEXT_CHARS)}\n--- end of ${name} ---` });
      } else {
        content.push({ type: "file", data: bytes, mediaType, filename: name });
      }
    }
    if (total > MAX_TOTAL_BYTES) throw new HttpError(413, "That is more than 4 MB at once. Send fewer pages per batch.");

    content.unshift({
      type: "text",
      text: `Turn ${files.length === 1 ? "this document" : `these ${files.length} documents`} into one inventory table.${hint ? ` About this business: ${hint}.` : ""} Files: ${names.join(", ")}.`,
    });
    const messages: ModelMessage[] = [{ role: "user", content }];
    const out = await structured<ExtractResult>({ schema, system: SYSTEM, messages });

    // Keep rows rectangular so the wizard's parser never sees a ragged table.
    const width = out.headers.length;
    const rows = out.rows.map((r) => Array.from({ length: width }, (_, i) => String(r[i] ?? "").trim())).filter((r) => r.some(Boolean));
    console.log("[import-extract]", files.length, "files", rows.length, "rows", out.documentType);
    return Response.json({ ...out, headers: out.headers.map((h) => h.trim()), rows });
  } catch (e) {
    if (e instanceof GeminiUnavailable) return Response.json({ error: e.message }, { status: 503 });
    return jsonError(e);
  }
}
