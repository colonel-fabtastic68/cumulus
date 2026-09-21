import { createGoogle } from "@ai-sdk/google";
import { convertToModelMessages, createUIMessageStreamResponse, streamText, toUIMessageStream, wrapLanguageModel, type UIMessage } from "ai";
import { fallbackMiddleware } from "@/lib/agent/fallback";
import { founderSystemPrompt } from "@/lib/server/founderChat";
import { rateLimited } from "@/lib/server/mailingList";

export const maxDuration = 60;

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
const FALLBACKS = (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3.7-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.6-flash").split(",").map((m) => m.trim()).filter(Boolean);
const MAX_TURNS = 20;
const MAX_CHARS = 2000;

/** Public, unauthenticated chat about cumulusOS. Rate-limited per connection and capped in length; it holds no workspace data. */
export async function POST(req: Request) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) return Response.json({ error: "The assistant is not switched on for this site yet." }, { status: 503 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
  if (rateLimited(`founder:${ip}`, 30, 10 * 60_000)) return Response.json({ error: "That's a lot of questions at once; give it a minute." }, { status: 429 });
  let body: { messages?: UIMessage[] };
  try {
    body = (await req.json()) as { messages?: UIMessage[] };
  } catch {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  const messages = (body.messages ?? []).slice(-MAX_TURNS).map((m) => ({ ...m, parts: m.parts.map((p) => (p.type === "text" ? { ...p, text: p.text.slice(0, MAX_CHARS) } : p)) }));
  if (messages.length === 0) return Response.json({ error: "Say something first." }, { status: 400 });
  const google = createGoogle({ apiKey });
  const result = streamText({
    model: wrapLanguageModel({ model: google(MODEL), middleware: fallbackMiddleware({ models: [MODEL, ...FALLBACKS], resolve: (id) => google(id), budgetMs: 45_000, log: (line) => console.warn(line) }) }),
    instructions: founderSystemPrompt(),
    messages: await convertToModelMessages(messages),
    maxOutputTokens: 600,
  });
  return createUIMessageStreamResponse({ stream: toUIMessageStream(result) });
}
