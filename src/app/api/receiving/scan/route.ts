import { createGoogle } from "@ai-sdk/google";
import { generateObject } from "ai";
import { z } from "zod";

export const maxDuration = 60;

const MODEL = process.env.GEMINI_VISION_MODEL ?? process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
const MAX_IMAGE_CHARS = 12_000_000; // ~9 MB of base64

const resultSchema = z.object({
  lines: z.array(
    z.object({
      sku: z.string().describe("The SKU exactly as printed on the sheet"),
      checked: z.boolean().nullable().describe("Whether the Done box is ticked; null when unreadable"),
      found: z.number().nullable().describe("The handwritten number in the Found column; null when the column is blank or unreadable"),
      confidence: z.enum(["high", "medium", "low"]),
      note: z.string().nullable().describe("Anything handwritten in the Note column"),
    }),
  ),
  remarks: z.string().nullable().describe("Anything else worth telling the person: smudged rows, a line crossed out, an extra item written in"),
});

/**
 * Reads a photo of a filled-in receiving checklist. The expected lines are
 * sent along so the model matches rows by SKU and never invents one. Nothing
 * is written here; the page shows what was read and the person confirms it.
 */
export async function POST(req: Request) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) return Response.json({ error: "Reading photos needs GOOGLE_GENERATIVE_AI_API_KEY on the server." }, { status: 503 });
  let body: { image?: unknown; lines?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Send JSON with an image and the expected lines." }, { status: 400 });
  }
  const image = typeof body.image === "string" ? body.image : "";
  const m = /^data:(image\/(?:png|jpeg|jpg|webp|heic|heif));base64,([A-Za-z0-9+/=]+)$/.exec(image);
  if (!m) return Response.json({ error: "Attach a photo (PNG, JPEG or WebP)." }, { status: 400 });
  if (image.length > MAX_IMAGE_CHARS) return Response.json({ error: "That photo is too large; use one under 8 MB." }, { status: 413 });
  const lines = Array.isArray(body.lines) ? (body.lines as Array<{ sku?: unknown; name?: unknown; qty?: unknown }>).filter((l) => typeof l.sku === "string").slice(0, 200) : [];
  if (lines.length === 0) return Response.json({ error: "No expected lines were sent." }, { status: 400 });

  const google = createGoogle({ apiKey });
  const expected = lines.map((l) => `${String(l.sku)} | ${typeof l.name === "string" ? l.name : ""} | expected ${typeof l.qty === "number" ? l.qty : "?"}`).join("\n");
  try {
    const { object } = await generateObject({
      model: google(MODEL),
      schema: resultSchema,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `This is a photo of a printed receiving checklist from an inventory system, filled in by hand. Each row has: a row number, a Done checkbox, the SKU, the item name, the Expected quantity (printed), a Found column (handwritten, often blank), a Bin and a Note column.

Read every row. Report the SKU exactly as printed, whether the Done box is ticked, and the handwritten number in the Found column (null when blank). Handwritten digits can be sloppy: use the expected quantity as a plausibility check but never copy it into Found when the column is empty. Only report SKUs from this list, in this order:

${expected}`,
            },
            { type: "image", image: Buffer.from(m[2]!, "base64"), mediaType: m[1] === "image/jpg" ? "image/jpeg" : m[1]! },
          ],
        },
      ],
    });
    const known = new Set(lines.map((l) => String(l.sku).toUpperCase()));
    const read = object.lines.filter((l) => known.has(l.sku.toUpperCase()));
    return Response.json({ lines: read, remarks: object.remarks, model: MODEL });
  } catch (e) {
    console.error("[receiving scan]", e);
    return Response.json({ error: e instanceof Error ? e.message : "Could not read the photo." }, { status: 502 });
  }
}
