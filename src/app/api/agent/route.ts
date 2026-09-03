import { createGoogle } from "@ai-sdk/google";
import { APICallError, convertToModelMessages, createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, wrapLanguageModel, type LanguageModelMiddleware, type UIMessage } from "ai";
import { agentTools } from "@/lib/agent/tools";

export const maxDuration = 60;

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
/** Tried in order when the primary model is overloaded (503), rate-limited (429), retired for this key, or slow to answer. */
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3.7-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.6-flash")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s && s !== MODEL);

/** How long a model may take to start responding before the next one is tried. */
const CONNECT_TIMEOUT_MS = Number(process.env.GEMINI_CONNECT_TIMEOUT_MS ?? 15_000);

class ModelTimeoutError extends Error {
  constructor(id: string) {
    super(`${id} did not start responding within ${CONNECT_TIMEOUT_MS / 1000}s`);
    this.name = "ModelTimeoutError";
  }
}

/** Errors worth trying the next model for: capacity problems, slow starts, and models this key can no longer use. */
function shouldFallback(e: unknown): boolean {
  if (e instanceof ModelTimeoutError) return true;
  const msg = e instanceof Error ? e.message : String(e);
  if (/no longer available|not available to new users|not found for API version|is not supported|has been deprecated|does not exist/i.test(msg)) return true;
  if (APICallError.isInstance(e)) return e.statusCode === 503 || e.statusCode === 429 || e.statusCode === 404 || e.isRetryable;
  return /high demand|overloaded|503|429|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(msg);
}

/**
 * Run `attempt` with an abort signal that fires if the model has not started
 * responding within CONNECT_TIMEOUT_MS. Once the response has started the
 * stream itself is not time-limited.
 */
async function withConnectTimeout<T>(id: string, upstream: AbortSignal | undefined, attempt: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  const controller = new AbortController();
  const onUpstreamAbort = () => controller.abort();
  upstream?.addEventListener("abort", onUpstreamAbort);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ModelTimeoutError(id));
    }, CONNECT_TIMEOUT_MS);
  });
  try {
    return await Promise.race([Promise.resolve(attempt(controller.signal)), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    upstream?.removeEventListener("abort", onUpstreamAbort);
  }
}

/**
 * Primary Gemini model with automatic fallback: if a model is overloaded,
 * retired, or slow to start, the same request is retried on the next model.
 */
function modelWithFallback(google: ReturnType<typeof createGoogle>) {
  const candidates = [MODEL, ...FALLBACK_MODELS];
  const middleware: LanguageModelMiddleware = {
    wrapStream: async ({ params, model }) => {
      let last: unknown;
      for (const [i, id] of candidates.entries()) {
        const candidate = i === 0 ? model : google(id);
        try {
          return await withConnectTimeout(id, params.abortSignal, (signal) => candidate.doStream({ ...params, abortSignal: signal }));
        } catch (e) {
          if (params.abortSignal?.aborted) throw e; // the client went away
          if (!shouldFallback(e)) throw e;
          last = e;
          const next = candidates[i + 1];
          if (next) console.warn(`[agent] ${id} unavailable (${e instanceof Error ? e.message.slice(0, 90) : String(e)}); trying ${next}`);
        }
      }
      throw last;
    },
    wrapGenerate: async ({ params, model }) => {
      let last: unknown;
      for (const [i, id] of candidates.entries()) {
        const candidate = i === 0 ? model : google(id);
        try {
          return await withConnectTimeout(id, params.abortSignal, (signal) => candidate.doGenerate({ ...params, abortSignal: signal }));
        } catch (e) {
          if (params.abortSignal?.aborted) throw e;
          if (!shouldFallback(e)) throw e;
          last = e;
        }
      }
      throw last;
    },
  };
  return wrapLanguageModel({ model: google(MODEL), middleware });
}

/** Turn provider errors into something the person in the chat can act on. */
function friendlyError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/did not start responding|high demand|overloaded|503|UNAVAILABLE/i.test(msg)) return `Gemini is overloaded right now (tried ${[MODEL, ...FALLBACK_MODELS].join(", ")}). Wait a moment and send the message again.`;
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) return "Gemini rate limit or quota reached for this API key. Wait a minute or raise the quota in Google AI Studio.";
  if (/API key|401|403|PERMISSION_DENIED/i.test(msg)) return "Gemini rejected the API key. Check GOOGLE_GENERATIVE_AI_API_KEY in .env.local and restart the dev server.";
  if (/no longer available|not available to new users|not found|404/i.test(msg)) return `Gemini reported that the models we tried (${[MODEL, ...FALLBACK_MODELS].join(", ")}) are not available to this key. Set GEMINI_MODEL / GEMINI_FALLBACK_MODELS in the environment to models listed for your key (for example gemini-3.6-flash).`;
  return msg;
}

function systemPrompt(context: string, userName: string, autoApprove: boolean) {
  return `You are Cumulus, the inventory agent for a small company. You work inside their inventory workspace and can read everything and change anything through tools.

You are talking with ${userName}. Today is ${new Date().toISOString().slice(0, 10)}.

## How to work
- Be concise and concrete. Prefer short tables or bullet lists over prose. Use SKUs.
- Read before you write: call getWorkspaceSummary / searchItems / getItem / getReport to ground yourself. Never guess quantities, costs or SKUs.
- For bulk changes, use previewBulkUpdate first when the scope is large or ambiguous, then bulkUpdateItems with a clear reason.
- ${autoApprove ? "Write tools apply immediately." : "Write tools are shown to the user for approval before they run. If a tool result says it was rejected, do not retry it; ask what to change."}
- Every quantity change goes through the stock ledger. Use adjustStock for counts and write-offs, receiveStock for goods in, buildAssembly for production, fulfillOrders for goods out.
- Bad data in = bad data out. When the user's request would create inconsistent data (duplicate SKUs, negative stock, BOM loops), say so and propose the correct approach.
- Think in the user's domain: min/max, lead times, shelf life, BOM explosion, where-used, superseded part numbers, RMAs, write-offs, seasonality, projections.
- When asked for projections, use consumption and seasonality reports and show your arithmetic briefly.
- After changes, summarise exactly what changed (counts, SKUs) in one or two lines.
- Never invent integrations. Shopify/WooCommerce are not connected yet unless the summary says otherwise.
- Format money with two decimals and the workspace currency.

## Workspace snapshot
${context}`;
}

/** Lightweight status check used by Settings and the Agents page. */
export async function GET() {
  const configured = Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY);
  return Response.json({ configured, model: MODEL, fallbacks: FALLBACK_MODELS });
}

export async function POST(req: Request) {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "Missing GOOGLE_GENERATIVE_AI_API_KEY. Add it to .env.local to enable the agent." },
      { status: 503 },
    );
  }
  const body = (await req.json()) as { messages: UIMessage[]; context?: string; userName?: string; autoApprove?: boolean };
  const google = createGoogle({ apiKey });

  const result = streamText({
    model: modelWithFallback(google),
    instructions: systemPrompt(body.context ?? "(no snapshot provided)", body.userName ?? "a teammate", body.autoApprove ?? false),
    messages: await convertToModelMessages(body.messages),
    tools: agentTools,
    stopWhen: isStepCount(12),
    // Fallback models run inside each attempt, so one retry is plenty.
    maxRetries: 1,
    onError: ({ error }) => {
      console.error("[agent]", error instanceof Error ? error.message : error);
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      onError: friendlyError,
    }),
  });
}
