import { z } from "zod";
import { GeminiUnavailable, structured } from "@/lib/gemini";

export const maxDuration = 30;

/** Reads a sentence like "what if sales grow 20% through Christmas" into projection settings. */
const body = z.object({
  text: z.string().min(1).max(1000),
  current: z.object({ horizonDays: z.number(), historyDays: z.number(), growthPct: z.number(), seasonality: z.boolean(), priceChangePct: z.number(), costChangePct: z.number() }),
  categories: z.array(z.string()).max(200),
  skus: z.array(z.string()).max(3000),
  today: z.string(),
});

const scenarioSchema = z.object({
  horizonDays: z.number().optional().describe("Days ahead to project, 7 to 730"),
  historyDays: z.number().optional().describe("Days of history that set the usage rate, 14 to 365"),
  growthPct: z.number().optional().describe("Demand change vs recent usage in percent; 20 means 20% more, -10 means 10% less"),
  seasonality: z.boolean().optional().describe("Whether to shape the forecast by last year's monthly pattern"),
  priceChangePct: z.number().optional().describe("List price change across the horizon in percent"),
  costChangePct: z.number().optional().describe("Unit cost change across the horizon in percent"),
  scope: z.union([z.object({ kind: z.literal("company") }), z.object({ kind: z.literal("category"), category: z.string() }), z.object({ kind: z.literal("sku"), sku: z.string() })]).optional().describe("Only when the sentence names a SKU, a category, or asks for the whole company"),
  reading: z.string().describe("One sentence: how the request was interpreted, including any assumption"),
});

export async function POST(req: Request) {
  let input: z.infer<typeof body>;
  try {
    input = body.parse(await req.json());
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    const scenario = await structured({
      schema: scenarioSchema,
      system: `You translate what-if questions about inventory into projection settings. Today is ${input.today}. Only set fields the request implies; leave the rest unset. Horizons: "next quarter" = 90 days, "through the holidays" = days until Jan 1, "next year" = 365. Growth is relative to recent usage. Mention assumptions in "reading". Known categories: ${input.categories.join(", ") || "(none)"}. Known SKUs (match exactly, case-insensitive): ${input.skus.slice(0, 400).join(", ")}${input.skus.length > 400 ? ", …" : ""}. Current settings: ${JSON.stringify(input.current)}.`,
      prompt: input.text,
    });
    return Response.json(scenario);
  } catch (e) {
    if (e instanceof GeminiUnavailable) return Response.json({ error: e.message }, { status: 503 });
    return Response.json({ error: e instanceof Error ? e.message : "Could not read the scenario" }, { status: 502 });
  }
}
