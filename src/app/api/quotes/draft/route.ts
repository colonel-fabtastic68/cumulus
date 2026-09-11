import { z } from "zod";
import { GeminiUnavailable, structured } from "@/lib/gemini";

export const maxDuration = 60;

/**
 * Turns a plain-language request into quote lines using only the workspace's
 * own catalogue, which the client sends along (no server-side data access,
 * like the chat route). The client then prices the lines from the items.
 */
const catalogItem = z.object({ sku: z.string(), name: z.string(), category: z.string().optional(), type: z.string().optional(), unit: z.string().optional(), price: z.number(), unitCost: z.number(), onHand: z.number(), bom: z.array(z.object({ sku: z.string(), qty: z.number() })).optional() });

const body = z.object({
  prompt: z.string().min(1).max(4000),
  currency: z.string().default("USD"),
  laborRate: z.number().default(0),
  catalog: z.array(catalogItem).max(2000),
});

const draftSchema = z.object({
  customer: z.string().optional().describe("Customer or company name if the request names one"),
  customerEmail: z.string().optional(),
  notes: z.string().optional().describe("A short note for the customer, e.g. assumptions or lead time"),
  lines: z.array(
    z.object({
      kind: z.enum(["item", "labor", "other"]),
      sku: z.string().optional().describe("Exact SKU from the catalogue for item lines"),
      description: z.string().describe("Line description shown to the customer"),
      qty: z.number().optional().describe("Quantity for item/other lines"),
      hours: z.number().optional().describe("Hours for labour lines"),
      unitPrice: z.number().optional().describe("Only when the request states a price; otherwise leave unset so the catalogue price applies"),
      reason: z.string().optional().describe("Why this line is included, one clause"),
    }),
  ),
  questions: z.array(z.string()).optional().describe("Anything unclear that the person should confirm before sending"),
});

export type QuoteDraftResponse = z.infer<typeof draftSchema>;

export async function POST(req: Request) {
  let input: z.infer<typeof body>;
  try {
    input = body.parse(await req.json());
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  const catalog = input.catalog.map((c) => `${c.sku} | ${c.name}${c.category ? ` | ${c.category}` : ""}${c.type === "assembly" ? " | assembly" : ""} | price ${c.price} | cost ${c.unitCost} | on hand ${c.onHand}${c.unit ? ` ${c.unit}` : ""}${c.bom?.length ? ` | BOM: ${c.bom.map((b) => `${b.sku}×${b.qty}`).join(", ")}` : ""}`).join("\n");
  try {
    const draft = await structured({
      schema: draftSchema,
      system: `You draft sales quotes for an inventory business. Use ONLY SKUs from the catalogue; never invent items. Match the request to catalogue items by name, category or purpose. When the request asks for something the catalogue does not have, add an "other" line with a description and no price rather than guessing a SKU. Labour is charged at ${input.laborRate} ${input.currency} per hour; add labour lines when work is implied (assembly, installation, setup, testing) and estimate hours sensibly. Do not set unitPrice unless the request states a price; the catalogue price is applied afterwards. Keep descriptions short and customer-facing. Currency: ${input.currency}.`,
      prompt: `Request:\n${input.prompt}\n\nCatalogue (SKU | name | category | price | cost | on hand):\n${catalog || "(empty)"}`,
    });
    return Response.json(draft);
  } catch (e) {
    if (e instanceof GeminiUnavailable) return Response.json({ error: e.message }, { status: 503 });
    return Response.json({ error: e instanceof Error ? e.message : "Could not draft the quote" }, { status: 502 });
  }
}
