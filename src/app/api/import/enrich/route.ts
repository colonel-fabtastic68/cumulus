import { z } from "zod";
import { HttpError, jsonError, readJson } from "@/lib/integrations/server";
import { GeminiUnavailable, geminiConfigured, structured } from "@/lib/gemini";
import { authenticateForStrato } from "@/lib/server/stratoAuth";

export const maxDuration = 120;

/** Rows per model call; the browser sends batches. */
const MAX_ROWS = 150;

/** What the browser sends per row: the mapped values, trimmed to what helps a suggestion. */
const rowSchema = z.object({
  line: z.number(),
  sku: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  unit: z.string().optional(),
  qty: z.number().optional(),
  unitCost: z.number().optional(),
  price: z.number().optional(),
  minQty: z.number().optional(),
  maxQty: z.number().optional(),
  supplierName: z.string().optional(),
  type: z.enum(["part", "assembly"]).optional(),
  /** Unmapped source columns, for context (free text that may hold a count or a unit). */
  extra: z.record(z.string(), z.string()).optional(),
});

const suggestionSchema = z.object({
  line: z.number(),
  /** Only when the row had none. Follows the style of SKUs already in use. */
  sku: z.string().optional(),
  category: z.string().optional(),
  unit: z.string().optional(),
  type: z.enum(["part", "assembly"]).optional(),
  minQty: z.number().optional(),
  maxQty: z.number().optional(),
  /** Only when a count is plainly written in the row's text ("12 in stock") and the row had no quantity. */
  qty: z.number().optional(),
  /** One short clause saying why, e.g. "unit from '25 kg bag' in the description". */
  note: z.string().optional(),
});

const schema = z.object({
  suggestions: z.array(suggestionSchema),
  /** One or two sentences for the person: what was filled in and what still needs their eyes. */
  summary: z.string(),
});

export type EnrichSuggestion = z.infer<typeof suggestionSchema>;
export type EnrichResult = z.infer<typeof schema>;

const SYSTEM = `You are Strato, the inventory assistant in cumulusOS. A spreadsheet is being imported and some cells are empty. Suggest values for the empty ones only; never change a value that is present.

- sku: only for rows without one. Make it from the name in the same style as the example SKUs you are given (same separators, same case, similar length). Unique across the batch; never reuse an existing SKU.
- category: a short label consistent across similar rows; reuse the workspace's existing categories when one fits.
- unit: ea unless the name or description says otherwise (kg, g, lb, m, ft, L, box, roll, pair, set…).
- type: "assembly" only when the row is plainly something built from other items (kit, bundle, finished build); otherwise "part".
- minQty / maxQty: a sensible reorder point and target for a small business, from the quantity, cost and what the item is. Cheap consumables get higher levels than expensive or slow items. Skip both when the row has no quantity and nothing to go on.
- qty: only when a count is written in the row's own text and the row has no quantity. Never guess counts.
- Do not return a suggestion object for a row with nothing to add.`;

/** Suggests values for empty cells (SKUs, categories, units, min/max, counts written in text). The browser decides what to apply. */
export async function POST(req: Request) {
  try {
    await authenticateForStrato(req);
    if (!geminiConfigured()) throw new GeminiUnavailable("Strato needs a Gemini key (GOOGLE_GENERATIVE_AI_API_KEY) to fill in gaps.");
    const body = await readJson<{ rows?: unknown; exampleSkus?: unknown; categories?: unknown; takenSkus?: unknown; hint?: unknown; fields?: unknown }>(req);
    const parsedRows = z.array(rowSchema).max(MAX_ROWS).safeParse(body.rows);
    if (!parsedRows.success || parsedRows.data.length === 0) throw new HttpError(400, `Send 1–${MAX_ROWS} rows.`);
    const strings = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : []);
    const exampleSkus = strings(body.exampleSkus, 25);
    const categories = strings(body.categories, 60);
    const takenSkus = strings(body.takenSkus, 400);
    const fields = strings(body.fields, 8);
    const hint = typeof body.hint === "string" ? body.hint.slice(0, 600) : "";

    const prompt = [
      fields.length ? `Fill in only these fields: ${fields.join(", ")}.` : "",
      hint ? `About this business: ${hint}.` : "",
      exampleSkus.length ? `SKUs already in use (match their style): ${exampleSkus.join(", ")}` : "No SKUs exist yet; use UPPER-CASE words joined by hyphens, e.g. WAGYU-RIBEYE.",
      categories.length ? `Existing categories: ${categories.join(", ")}` : "",
      takenSkus.length ? `Never produce one of these SKUs: ${takenSkus.join(", ")}` : "",
      `Rows:\n${JSON.stringify(parsedRows.data)}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const out = await structured<EnrichResult>({ schema, system: SYSTEM, prompt });

    // Belt and braces: a suggestion never overwrites a value the row already had, and SKUs stay unique.
    const byLine = new Map(parsedRows.data.map((r) => [r.line, r]));
    const seen = new Set(takenSkus.map((s) => s.toUpperCase()));
    for (const r of parsedRows.data) if (r.sku) seen.add(r.sku.toUpperCase());
    const suggestions: EnrichSuggestion[] = [];
    for (const s of out.suggestions) {
      const row = byLine.get(s.line);
      if (!row) continue;
      const keep: EnrichSuggestion = { line: s.line, note: s.note };
      if (s.sku && !row.sku) {
        const sku = s.sku.trim().toUpperCase();
        if (sku && !seen.has(sku)) {
          seen.add(sku);
          keep.sku = sku;
        }
      }
      if (s.category && !row.category) keep.category = s.category.trim();
      if (s.unit && !row.unit) keep.unit = s.unit.trim();
      if (s.type && !row.type) keep.type = s.type;
      if (s.minQty !== undefined && row.minQty === undefined && s.minQty >= 0) keep.minQty = Math.round(s.minQty);
      if (s.maxQty !== undefined && row.maxQty === undefined && s.maxQty >= 0) keep.maxQty = Math.round(s.maxQty);
      if (keep.minQty !== undefined && keep.maxQty !== undefined && keep.maxQty < keep.minQty) keep.maxQty = keep.minQty;
      if (s.qty !== undefined && row.qty === undefined && s.qty >= 0) keep.qty = s.qty;
      if (Object.keys(keep).some((k) => k !== "line" && k !== "note" && keep[k as keyof EnrichSuggestion] !== undefined)) suggestions.push(keep);
    }
    return Response.json({ suggestions, summary: out.summary } satisfies EnrichResult);
  } catch (e) {
    if (e instanceof GeminiUnavailable) return Response.json({ error: e.message }, { status: 503 });
    return jsonError(e);
  }
}
