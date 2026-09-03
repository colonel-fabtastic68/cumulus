import { createGoogle } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";

export const maxDuration = 30;

const TARGET_FIELDS = ["sku", "name", "description", "category", "type", "unit", "qty", "unitCost", "price", "minQty", "maxQty", "leadTimeDays", "location", "barcode", "supplierName", "tags", "ignore"] as const;

const schema = z.object({
  mappings: z.array(z.object({ column: z.string(), field: z.enum(TARGET_FIELDS), confidence: z.number().min(0).max(1) })),
  notes: z.string().optional(),
});

/** Ask Gemini to map CSV headers to Cumulus item fields. Falls back to heuristics when no key. */
export async function POST(req: Request) {
  const { headers, sample } = (await req.json()) as { headers: string[]; sample: Record<string, string>[] };
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: "no_api_key" }, { status: 503 });
  const google = createGoogle({ apiKey });
  const { output } = await generateText({
    model: google(process.env.GEMINI_MODEL ?? "gemini-3.8-flash"),
    output: Output.object({ schema }),
    prompt: `Map these spreadsheet columns to inventory item fields. Target fields: ${TARGET_FIELDS.join(", ")}. Use "ignore" for columns that don't fit. "qty" is the on-hand quantity. "unitCost" is what we pay; "price" is what we sell for. "type" is part or assembly.\n\nColumns: ${JSON.stringify(headers)}\n\nSample rows:\n${JSON.stringify(sample.slice(0, 5), null, 1)}`,
  });
  return Response.json(output);
}
