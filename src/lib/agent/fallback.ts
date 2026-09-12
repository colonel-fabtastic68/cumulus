import { APICallError, type LanguageModel, type LanguageModelMiddleware } from "ai";

/**
 * Model fallback for Nimbus. One request may try several Gemini models: the
 * primary, then the fallbacks, each with a connect timeout scaled to the size
 * of the prompt, all inside one time budget. A quota answer that names a
 * retry delay earns a second pass after that delay. Every attempt is recorded
 * so the error the person sees says what actually happened.
 */

export type Outcome = "quota" | "overloaded" | "timeout" | "unavailable" | "error";

export interface Attempt {
  model: string;
  outcome: Outcome;
  detail: string;
  retryAfterMs?: number;
  ms: number;
}

export class ModelChainError extends Error {
  constructor(
    public attempts: Attempt[],
    public promptChars: number,
  ) {
    super(describeAttempts(attempts));
    this.name = "ModelChainError";
  }
}

class ModelTimeoutError extends Error {
  constructor(id: string, ms: number) {
    super(`${id} did not start responding within ${ms < 10_000 ? (ms / 1000).toFixed(1) : String(Math.round(ms / 1000))}s`);
    this.name = "ModelTimeoutError";
  }
}

export interface ChainOptions {
  /** Primary first, then fallbacks. */
  models: string[];
  resolve: (id: string) => LanguageModel;
  /** How long a model may take to start answering, given the prompt size. */
  connectTimeoutMs?: (promptChars: number) => number;
  /** Total time the chain may spend, including any wait before a second pass. */
  budgetMs?: number;
  /** Longest quota-imposed wait worth sitting through. */
  maxWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}

/** Twenty-five seconds for a small prompt, up to a minute for a long conversation. */
export function defaultConnectTimeout(promptChars: number): number {
  return Math.min(60_000, 25_000 + Math.floor(promptChars / 10_000) * 1_000);
}

export function classify(e: unknown): { outcome: Outcome; detail: string; retryAfterMs?: number } {
  if (e instanceof ModelTimeoutError) return { outcome: "timeout", detail: e.message };
  const msg = e instanceof Error ? e.message : String(e);
  const status = APICallError.isInstance(e) ? e.statusCode : undefined;
  const body = APICallError.isInstance(e) ? (e.responseBody ?? "") : "";
  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(msg + body)) {
    return { outcome: "quota", detail: "quota exceeded", retryAfterMs: retryAfterFrom(e, body) };
  }
  if (status === 503 || /high demand|overloaded|UNAVAILABLE|\b503\b/i.test(msg)) return { outcome: "overloaded", detail: "overloaded", retryAfterMs: retryAfterFrom(e, body) };
  if (status === 404 || /no longer available|not available to new users|not found for API version|is not supported|has been deprecated|does not exist|not found/i.test(msg)) return { outcome: "unavailable", detail: "not available to this key" };
  if (APICallError.isInstance(e) && e.isRetryable) return { outcome: "overloaded", detail: msg.slice(0, 80) };
  return { outcome: "error", detail: msg.slice(0, 160) };
}

/** Google puts the wait in the body ("retryDelay": "39s"); other providers use Retry-After. */
function retryAfterFrom(e: unknown, body: string): number | undefined {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  if (m) return Math.ceil(Number(m[1]) * 1000);
  const headers = APICallError.isInstance(e) ? e.responseHeaders : undefined;
  const ra = headers?.["retry-after"];
  if (ra && !Number.isNaN(Number(ra))) return Number(ra) * 1000;
  return undefined;
}

export function describeAttempts(attempts: Attempt[]): string {
  return attempts
    .map((a) => {
      const wait = a.retryAfterMs ? ` (retry in ${Math.ceil(a.retryAfterMs / 1000)}s)` : "";
      return `${a.model}: ${a.outcome === "timeout" ? `no reply within ${a.ms < 10_000 ? (a.ms / 1000).toFixed(1) : Math.round(a.ms / 1000)}s` : a.detail}${a.outcome === "quota" ? wait : ""}`;
    })
    .join("; ");
}

async function withTimeout<T>(id: string, ms: number, upstream: AbortSignal | undefined, attempt: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController();
  const onUpstreamAbort = () => controller.abort();
  upstream?.addEventListener("abort", onUpstreamAbort);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ModelTimeoutError(id, ms));
    }, ms);
  });
  try {
    return await Promise.race([Promise.resolve(attempt(controller.signal)), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    upstream?.removeEventListener("abort", onUpstreamAbort);
  }
}

/** Runs the chain for one model call (stream or generate). */
export async function runChain<T>(opts: ChainOptions, params: { prompt: unknown; abortSignal?: AbortSignal }, call: (model: LanguageModel, signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const connectTimeout = opts.connectTimeoutMs ?? defaultConnectTimeout;
  const budget = opts.budgetMs ?? 200_000;
  const maxWait = opts.maxWaitMs ?? 45_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const promptChars = safeLength(params.prompt);
  const started = Date.now();
  const attempts: Attempt[] = [];
  const elapsed = () => Date.now() - started;

  for (let pass = 1; pass <= 2; pass++) {
    for (const id of opts.models) {
      const remaining = budget - elapsed();
      if (remaining < 5_000) break;
      const ms = Math.min(connectTimeout(promptChars), remaining);
      const t0 = Date.now();
      try {
        const out = await withTimeout(id, ms, params.abortSignal, (signal) => call(opts.resolve(id), signal));
        if (attempts.length) opts.log?.(`[agent] ${id} answered after: ${describeAttempts(attempts)} (prompt ${Math.round(promptChars / 1000)}k chars)`);
        return out;
      } catch (e) {
        if (params.abortSignal?.aborted) throw e; // the client went away
        const c = classify(e);
        if (c.outcome === "error") throw e;
        attempts.push({ model: id, outcome: c.outcome, detail: c.detail, retryAfterMs: c.retryAfterMs, ms: Date.now() - t0 });
      }
    }
    if (pass === 1) {
      // A quota or overload answer that names a wait: sit it out once, then try the chain again.
      const waits = attempts.map((a) => a.retryAfterMs).filter((w): w is number => typeof w === "number" && w > 0);
      const wait = waits.length ? Math.min(...waits) : attempts.some((a) => a.outcome === "overloaded") ? 3_000 : 0;
      const remaining = budget - elapsed();
      // Only worth waiting when at least one full attempt still fits in the budget afterwards.
      if (!wait || wait > maxWait || wait + connectTimeout(promptChars) > remaining) break;
      opts.log?.(`[agent] waiting ${Math.ceil(wait / 1000)}s before a second pass: ${describeAttempts(attempts)}`);
      await sleep(wait);
    }
  }
  const err = new ModelChainError(attempts, promptChars);
  opts.log?.(`[agent] every model failed (prompt ${Math.round(promptChars / 1000)}k chars): ${err.message}`);
  throw err;
}

function safeLength(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Middleware that routes every call through the chain. The wrapped model itself is only a placeholder. */
export function fallbackMiddleware(opts: ChainOptions): LanguageModelMiddleware {
  return {
    wrapStream: ({ params }) => runChain(opts, params, (model, signal) => (model as unknown as { doStream: (p: unknown) => PromiseLike<never> }).doStream({ ...params, abortSignal: signal })),
    wrapGenerate: ({ params }) => runChain(opts, params, (model, signal) => (model as unknown as { doGenerate: (p: unknown) => PromiseLike<never> }).doGenerate({ ...params, abortSignal: signal })),
  };
}

/** What to tell the person in the chat. */
export function explainChainError(e: unknown, models: string[]): string {
  if (e instanceof ModelChainError) {
    const quota = e.attempts.some((a) => a.outcome === "quota");
    const waits = e.attempts.map((a) => a.retryAfterMs ?? 0).filter(Boolean);
    const wait = waits.length ? Math.ceil(Math.min(...waits) / 1000) : 60;
    if (quota) {
      return `The Gemini API key has hit its Google quota: ${e.message}. Long edits send the whole conversation to the model on every step, so a big one can use up a minute's token allowance. Wait about ${wait}s and press Try again; the changes already applied are kept. To stop this happening, enable billing on the key's project in Google AI Studio, which lifts the free-tier limits.`;
    }
    return `Gemini did not answer in time (${e.message}). The models are overloaded or slow at the moment. Press Try again; nothing already applied is lost.`;
  }
  const msg = e instanceof Error ? e.message : String(e);
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) return "Gemini rate limit or quota reached for this API key. Wait a minute and press Try again, or enable billing in Google AI Studio.";
  if (/API key|401|403|PERMISSION_DENIED/i.test(msg)) return "Gemini rejected the API key. Check GOOGLE_GENERATIVE_AI_API_KEY in .env.local and restart the dev server.";
  if (/no longer available|not available to new users|not found|404/i.test(msg)) return `Gemini reported that the models we tried (${models.join(", ")}) are not available to this key. Set GEMINI_MODEL / GEMINI_FALLBACK_MODELS in the environment to models listed for your key.`;
  if (/did not start responding|high demand|overloaded|503|UNAVAILABLE/i.test(msg)) return `Gemini is overloaded right now (tried ${models.join(", ")}). Wait a moment and press Try again.`;
  return msg;
}
