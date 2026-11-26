import type { FilePart, ModelMessage, TextPart } from "ai";
import { z } from "zod";
import { HttpError, jsonError, readJson } from "@/lib/integrations/server";
import { GeminiUnavailable, geminiConfigured, structured } from "@/lib/gemini";
import { serverFeatureEnabled } from "@/lib/features";
import { authenticateForStrato } from "@/lib/server/stratoAuth";
import { readingAddsUp, type PurchaseOrderReading } from "@/lib/poUpload";

export const maxDuration = 120;

/** Vercel functions take 4.5 MB bodies; photos are shrunk in the browser before they get here. */
const MAX_TOTAL_BYTES = 4_000_000;
const MAX_FILES = 12;
const MAX_TEXT_CHARS = 200_000;
const MAX_LINES = 400;
const MAX_SUPPLIERS = 300;

const IMAGE_TYPES = /^image\/(jpeg|png|webp|heic|heif|gif)$/;

interface IncomingFile {
  name?: unknown;
  mediaType?: unknown;
  /** Base64 for images and PDFs. */
  data?: unknown;
  /** The text itself for text files and sheets. */
  text?: unknown;
}

const schema = z.object({
  /** "purchase order", "quote", "order confirmation", "invoice", or what else it is in a few words. */
  documentType: z.string(),
  /** The company the goods are bought from, as printed. Empty when not shown. */
  supplier: z.string(),
  /** That company's name exactly as it appears in the suppliers on file, when it is one of them. Otherwise empty. */
  knownSupplier: z.string(),
  /** The buyer's purchase order number. Empty when the document has none. */
  poNumber: z.string(),
  /** The supplier's own number for this order: quote, confirmation, sales order or invoice number. */
  supplierReference: z.string(),
  /** When the goods are due, YYYY-MM-DD. Empty when not printed. */
  expectedDate: z.string(),
  /** Payment terms as printed ("Net 30"). */
  terms: z.string(),
  /** ISO 4217 code when the document names or clearly shows a currency. */
  currency: z.string(),
  /** Delivery instructions or remarks meant for the order. */
  note: z.string(),
  lines: z.array(
    z.object({
      /** Every part number, SKU, item or catalog number printed for the line, exactly as printed. */
      codes: z.array(z.string()),
      description: z.string(),
      qty: z.number().nullable(),
      /** Unit of measure as printed (ea, box, case, ft). Empty when not shown. */
      unit: z.string(),
      unitCost: z.number().nullable(),
      lineTotal: z.number().nullable(),
    }),
  ),
  subtotal: z.number().nullable(),
  shipping: z.number().nullable(),
  tax: z.number().nullable(),
  total: z.number().nullable(),
  /** Short plain sentences for anything the person should check. */
  warnings: z.array(z.string()),
  /** 0–1: how legible the source was. */
  confidence: z.number().min(0).max(1),
});

type Raw = z.infer<typeof schema>;

function system(company: string): string {
  return `You are Strato, the assistant in cumulusOS, an inventory system. A person uploads one purchasing document: a purchase order they wrote, or a supplier's quote, order confirmation, pro forma or invoice. Read it into the fields of one purchase order. The person checks your reading against the document before anything is saved, so accuracy matters more than completeness.

Rules:
- The supplier is the company the goods are bought FROM: the vendor or seller, the "to" party on a purchase order, the issuer of a quote or invoice. The buyer (ship to, bill to${company ? `, ${company}` : ""}) is never the supplier.
- knownSupplier: when the supplier is clearly one of the suppliers on file listed in the request (the same company, allowing for "Inc.", an abbreviation or a trading name), give that name exactly as listed. Otherwise leave it empty.
- poNumber is the buyer's purchase order number. A number that belongs to the supplier (quote, confirmation, sales order or invoice number) goes in supplierReference instead.
- Dates as YYYY-MM-DD. expectedDate is when the goods are due (delivery, due, ship-by or need-by date). Leave it empty when none is printed; do not work one out from a lead time.
- lines: one per ordered item, in the document's order. Subtotals, shipping, freight, tax, discounts and remarks are not lines; they go in the totals and note fields.
- codes: every part number, SKU, item number or catalog number printed for the line (the buyer's, the supplier's, the manufacturer's), each exactly as printed. Empty when the line has none.
- description as printed, without the codes.
- qty, unitCost and lineTotal are plain numbers as printed: no currency sign, no thousands separator. null when not printed. Never calculate one from the others.
- Never invent a value. When a digit or letter is hard to read, pick the most likely reading and say which line in warnings.
- warnings: anything the person should check: unreadable cells, a page that is cut off, handwritten changes, more than one order in the upload, a total that does not match its lines.
- If the upload is not a purchasing document, return no lines and say what it is in warnings.`;
}

function decodeBase64(data: string): Buffer {
  const comma = data.indexOf(",");
  return Buffer.from(comma >= 0 && data.startsWith("data:") ? data.slice(comma + 1) : data, "base64");
}

const num = (n: number | null): number | undefined => (n !== null && Number.isFinite(n) ? n : undefined);

function toReading(out: Raw, suppliers: string[]): PurchaseOrderReading {
  const known = out.knownSupplier.trim().toLowerCase();
  return {
    documentType: out.documentType.trim(),
    supplier: out.supplier.trim(),
    // Only a name that really is on file counts; anything else would be a guess passed off as a match.
    knownSupplier: known ? suppliers.find((s) => s.toLowerCase() === known) : undefined,
    poNumber: out.poNumber.trim(),
    reference: out.supplierReference.trim(),
    expectedDate: out.expectedDate.trim(),
    terms: out.terms.trim(),
    currency: out.currency.trim(),
    note: out.note.trim(),
    lines: out.lines
      .slice(0, MAX_LINES)
      .map((l) => ({ codes: l.codes.map((c) => c.trim()).filter(Boolean), description: l.description.trim(), qty: num(l.qty), unit: l.unit.trim() || undefined, unitCost: num(l.unitCost), lineTotal: num(l.lineTotal) }))
      .filter((l) => l.codes.length > 0 || l.description),
    subtotal: num(out.subtotal),
    shipping: num(out.shipping),
    tax: num(out.tax),
    total: num(out.total),
    warnings: out.warnings.map((w) => w.trim()).filter(Boolean),
    confidence: out.confidence,
  };
}

/** A quick reading is kept when the document's own arithmetic bears it out; an empty, shaky or inconsistent one is read again with more care. */
const needsSecondLook = (r: PurchaseOrderReading) => r.lines.length === 0 || r.confidence < 0.6 || readingAddsUp(r) === false;

/** Reads a purchasing document (PDF, photos, or the text of a sheet) into one purchase order's fields. Nothing is written; the browser matches it against the catalog and a person signs it off. */
export async function POST(req: Request) {
  try {
    await authenticateForStrato(req);
    // A workspace's own switch is checked in the browser; this asks whether the deployment offers the feature at all.
    if (!serverFeatureEnabled("poUpload", { poUpload: true })) throw new HttpError(404, "Uploading purchase orders is not switched on here.");
    if (!geminiConfigured()) throw new GeminiUnavailable("Strato can't read documents right now. Enter the order manually, or try again later.");
    const body = await readJson<{ files?: unknown; company?: unknown; suppliers?: unknown }>(req);
    const files = Array.isArray(body.files) ? (body.files as IncomingFile[]) : [];
    if (files.length === 0) throw new HttpError(400, "Attach a PDF, a photo or a spreadsheet.");
    if (files.length > MAX_FILES) throw new HttpError(400, `Up to ${MAX_FILES} pages at a time.`);
    const company = typeof body.company === "string" ? body.company.slice(0, 120) : "";
    const suppliers = Array.isArray(body.suppliers) ? body.suppliers.filter((s): s is string => typeof s === "string" && !!s.trim()).slice(0, MAX_SUPPLIERS).map((s) => s.slice(0, 120)) : [];

    const content: Array<TextPart | FilePart> = [];
    let total = 0;
    let textOnly = true;
    const names: string[] = [];
    for (const f of files) {
      const name = typeof f.name === "string" ? f.name.slice(0, 120) : "file";
      const mediaType = typeof f.mediaType === "string" ? f.mediaType.toLowerCase() : "";
      names.push(name);
      if (typeof f.text === "string") {
        const text = f.text.slice(0, MAX_TEXT_CHARS);
        total += text.length;
        content.push({ type: "text", text: `--- ${name} ---\n${text}\n--- end of ${name} ---` });
        continue;
      }
      if (typeof f.data !== "string" || !f.data) throw new HttpError(400, `${name} is empty.`);
      if (!IMAGE_TYPES.test(mediaType) && mediaType !== "application/pdf") throw new HttpError(400, `${name}: send a PDF, photos or a spreadsheet.`);
      const bytes = decodeBase64(f.data);
      total += bytes.byteLength;
      textOnly = false;
      content.push({ type: "file", data: bytes, mediaType, filename: name });
    }
    if (total > MAX_TOTAL_BYTES) throw new HttpError(413, "That is more than 4 MB. Send fewer pages, or a smaller PDF.");

    content.unshift({
      type: "text",
      text: `Read ${files.length === 1 ? "this document" : `these ${files.length} pages of one document`} into one purchase order. Files: ${names.join(", ")}.\n\nSuppliers on file:\n${suppliers.length ? suppliers.join("\n") : "(none yet)"}`,
    });
    const messages: ModelMessage[] = [{ role: "user", content }];
    const started = Date.now();
    // The light model reads a clean order in about two seconds. The main model, several times slower, is
    // kept for the readings that do not check out: its answer replaces the first one.
    const input = { schema, system: system(company), messages, abortSignal: req.signal };
    let reading = toReading(await structured<Raw>({ ...input, fast: true }), suppliers);
    let pass = "quick";
    if (needsSecondLook(reading)) {
      try {
        reading = toReading(await structured<Raw>(input), suppliers);
        pass = "careful";
      } catch (e) {
        if (req.signal.aborted) throw e;
        console.warn("[po-read] second look failed, keeping the quick reading", e instanceof Error ? e.message : e);
      }
    }
    const ms = Date.now() - started;
    console.log("[po-read]", files.length, "files", reading.lines.length, "lines", reading.documentType, `${ms}ms`, textOnly ? "text" : "vision", pass);
    return Response.json({ reading, ms });
  } catch (e) {
    // The person closed the pane mid-read: nobody is waiting for an answer, and it is not an error worth logging.
    if (req.signal.aborted) return new Response(null, { status: 499 });
    if (e instanceof GeminiUnavailable) return Response.json({ error: e.message }, { status: 503 });
    return jsonError(e);
  }
}
