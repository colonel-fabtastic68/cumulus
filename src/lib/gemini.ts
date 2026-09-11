import { createGoogle } from "@ai-sdk/google";
import { APICallError, generateText, Output } from "ai";
import type { z } from "zod";

/**
 * Server-side structured calls to Gemini for the quote drafter and the
 * projection scenario reader. Same model list as the chat route, tried in
 * order when one is overloaded or retired.
 */
const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3.7-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.6-flash")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s && s !== MODEL);

export class GeminiUnavailable extends Error {
  constructor(message = "Add a Gemini API key (GOOGLE_GENERATIVE_AI_API_KEY) to use this.") {
    super(message);
  }
}

function shouldFallback(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  if (/no longer available|not available to new users|not found for API version|is not supported|has been deprecated|does not exist/i.test(msg)) return true;
  if (APICallError.isInstance(e)) return e.statusCode === 503 || e.statusCode === 429 || e.statusCode === 404 || e.isRetryable;
  return /high demand|overloaded|503|429|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(msg);
}

export async function structured<T>(opts: { schema: z.ZodType<T>; system: string; prompt: string; abortSignal?: AbortSignal }): Promise<T> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiUnavailable();
  const google = createGoogle({ apiKey });
  let last: unknown;
  for (const id of [MODEL, ...FALLBACK_MODELS]) {
    try {
      const { output } = await generateText({ model: google(id), output: Output.object({ schema: opts.schema }), system: opts.system, prompt: opts.prompt, abortSignal: opts.abortSignal });
      return output as T;
    } catch (e) {
      last = e;
      if (!shouldFallback(e)) throw e;
    }
  }
  throw last instanceof Error ? last : new Error("Gemini did not answer");
}
