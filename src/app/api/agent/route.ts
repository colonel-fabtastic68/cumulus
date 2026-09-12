import { createGoogle } from "@ai-sdk/google";
import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, wrapLanguageModel, type UIMessage } from "ai";
import { agentTools } from "@/lib/agent/tools";
import { explainChainError, fallbackMiddleware } from "@/lib/agent/fallback";
import { compactHistory } from "@/lib/agent/history";

/** A long edit can take many model steps; give the whole exchange room to finish. */
export const maxDuration = 300;

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";
/** Tried in order when the primary model is over quota, overloaded, retired for this key, or slow to answer. */
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3.7-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.6-flash")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s && s !== MODEL);
const MODELS = [MODEL, ...FALLBACK_MODELS];

/**
 * Primary Gemini model with automatic fallback and a quota-aware second pass;
 * see lib/agent/fallback.ts. Attempts are logged as one line per call.
 */
function modelWithFallback(google: ReturnType<typeof createGoogle>) {
  return wrapLanguageModel({ model: google(MODEL), middleware: fallbackMiddleware({ models: MODELS, resolve: (id) => google(id), budgetMs: 220_000, log: (line) => console.warn(line) }) });
}

/** Turn provider errors into something the person in the chat can act on. */
function friendlyError(error: unknown): string {
  return explainChainError(error, MODELS);
}

function systemPrompt(context: string, userName: string, autoApprove: boolean) {
  return `You are Nimbus, the inventory assistant built into Cumulus, a small company's inventory workspace. You can read everything and change anything through tools. Refer to yourself as Nimbus.

You are talking with ${userName}. Today is ${new Date().toISOString().slice(0, 10)}.

## How to work
- Be concise and concrete. Prefer short tables or bullet lists over prose. Use SKUs.
- Read before you write: call getWorkspaceSummary / searchItems / getItem / getReport to ground yourself. Never guess quantities, costs or SKUs.
- For bulk changes, use previewBulkUpdate first when the scope is large or ambiguous, then bulkUpdateItems with a clear reason. Both take the same arguments: target with skus, a filter, or all: true; use set for a shared value, adjustPricePct / adjustCostPct for percentage changes, and lines for per-item values.
- Keep tool calls to a minimum. Look up several SKUs with ONE searchItems call (skus list) or one filter; never one call per SKU. Make ONE bulkUpdateItems / adjustStock / receiveStock call carrying every item or line, never one call per item; different values per item go in bulkUpdateItems.lines. The user approves each write call, so a dozen small calls means a dozen approvals.
- Mass edits (hundreds of items): when every target gets the same value, use filter or all: true with set, never lines. When each item needs its own value, put at most 120 lines in one bulkUpdateItems / adjustStock call and issue the calls back to back in the same turn; the user approves them together. Do not re-read items you already have; searchItems results from this conversation are enough.
- ${autoApprove ? "Write tools apply immediately." : "Write tools are shown to the user for approval before they run. If a tool result says it was rejected, do not retry it; ask what to change."}
- Every quantity change goes through the stock ledger. Use adjustStock for counts and write-offs, receiveStock for goods in, buildAssembly for production, fulfillOrders for goods out.
- Bad data in = bad data out. When the user's request would create inconsistent data (duplicate SKUs, negative stock, BOM loops), say so and propose the correct approach.
- Think in the user's domain: min/max, lead times, shelf life, BOM explosion, where-used, superseded part numbers and cross-references (OEM / competitor / supplier numbers), stock by location and bin, transfers in transit, partial shipments and backorders, RMAs, write-offs, seasonality, projections, turnover and fill rate (the kpis report).
- When asked for projections, use consumption and seasonality reports and show your arithmetic briefly.
- After changes, summarise exactly what changed (counts, SKUs) in one or two lines.
- Connections (Shopify, WooCommerce, Shippo, EasyPost) are listed in the workspace snapshot; getConnections has the detail (what syncs, last result, linked items, items not yet in the store). Only those are connected. syncChannel runs a sync (products and open orders in; pushStock / pushProducts send stock levels and new items out) and needs the user's approval like any write.
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
      { error: "Missing GOOGLE_GENERATIVE_AI_API_KEY. Add it to .env.local to enable Nimbus." },
      { status: 503 },
    );
  }
  const body = (await req.json()) as { messages: UIMessage[]; context?: string; userName?: string; autoApprove?: boolean };
  const google = createGoogle({ apiKey });

  const messages = compactHistory(body.messages);
  const result = streamText({
    model: modelWithFallback(google),
    instructions: systemPrompt(body.context ?? "(no snapshot provided)", body.userName ?? "a teammate", body.autoApprove ?? false),
    messages: await convertToModelMessages(messages),
    tools: agentTools,
    stopWhen: isStepCount(16),
    // Retries, fallbacks and quota waits all happen inside the chain.
    maxRetries: 0,
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
