import { createGoogle } from "@ai-sdk/google";
import { convertToModelMessages, createUIMessageStreamResponse, isStepCount, streamText, toUIMessageStream, type UIMessage } from "ai";
import { agentTools } from "@/lib/agent/tools";

export const maxDuration = 60;

const MODEL = process.env.GEMINI_MODEL ?? "gemini-3.8-flash";

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
  return Response.json({ configured, model: MODEL });
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
    model: google(MODEL),
    instructions: systemPrompt(body.context ?? "(no snapshot provided)", body.userName ?? "a teammate", body.autoApprove ?? false),
    messages: await convertToModelMessages(body.messages),
    tools: agentTools,
    stopWhen: isStepCount(12),
    onError: ({ error }) => {
      console.error("[agent]", error);
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      onError: (error) => (error instanceof Error ? error.message : String(error)),
    }),
  });
}
