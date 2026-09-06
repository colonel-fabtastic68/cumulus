/**
 * Minimal Model Context Protocol server for Cumulus.
 *
 * Speaks JSON-RPC 2.0 over Streamable HTTP (POST /api/mcp) and exposes the
 * exact tool set Nimbus uses, so any MCP-capable agent (Claude Code, Claude
 * Desktop, Cursor, custom agents) can query inventory and perform the same
 * operations. Stateless: every request stands on its own; no session ids.
 */
import { z } from "zod";
import { agentTools, isWriteTool, TOOL_LABELS, type AgentToolName } from "@/lib/agent/tools";
import { executeTool, type ExecContext } from "@/lib/agent/execute";
import { getServerStore } from "./store";

export const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const LATEST_PROTOCOL = PROTOCOL_VERSIONS[0];
export const SERVER_INFO = { name: "cumulus", title: "Cumulus inventory", version: "0.1.0" };

/** The identity external agents act as; activity entries name it. */
export const MCP_ACTOR = { id: "mcp", name: "External agent" };

const SUMMARY_RESOURCE = "cumulus://workspace/summary";

export const SERVER_INSTRUCTIONS = [
  "Cumulus is an inventory workspace. Tools mirror what the built-in assistant (Nimbus) can do: read items, BOMs and reports, and perform stock operations.",
  "Read before you write: call getWorkspaceSummary or searchItems first. Quantities always flow through the stock ledger.",
  "Write tools (bulkUpdateItems, adjustStock, receiveStock, buildAssembly, updateBom, deactivateItems, createOrder, fulfillOrders, createRma, resolveRma, upsertSupplier, deleteItems) change data immediately.",
].join(" ");

type JsonRpcId = string | number | null;
interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const ERR = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 };

function ok(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}
function fail(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

type ZodLike = Parameters<typeof z.toJSONSchema>[0];

/** Nimbus tool → MCP tool descriptor with a JSON Schema input. */
export function listTools() {
  return (Object.keys(agentTools) as AgentToolName[]).map((name) => {
    const t = agentTools[name] as { description?: string; inputSchema: unknown };
    const schema = z.toJSONSchema(t.inputSchema as ZodLike) as Record<string, unknown>;
    delete schema.$schema;
    return {
      name,
      title: TOOL_LABELS[name],
      description: t.description ?? "",
      inputSchema: schema,
      annotations: {
        title: TOOL_LABELS[name],
        readOnlyHint: !isWriteTool(name),
        destructiveHint: name === "deleteItems",
        idempotentHint: false,
        openWorldHint: false,
      },
    };
  });
}

export function listResources() {
  return [
    {
      uri: SUMMARY_RESOURCE,
      name: "workspace-summary",
      title: "Workspace summary",
      description: "Item counts, inventory value, low-stock SKUs, open orders and returns, categories and suppliers.",
      mimeType: "application/json",
    },
  ];
}

async function execContext(): Promise<ExecContext> {
  const { store } = await getServerStore();
  return { store, actor: MCP_ACTOR };
}

async function callTool(name: string, args: unknown) {
  if (!(name in agentTools)) throw new ToolError(`Unknown tool "${name}"`);
  const toolName = name as AgentToolName;
  const schema = (agentTools[toolName] as { inputSchema: unknown }).inputSchema as z.ZodType;
  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) throw new ToolError(`Invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  const ctx = await execContext();
  return executeTool(toolName, parsed.data, ctx);
}

class ToolError extends Error {}

function negotiate(requested: unknown): string {
  return typeof requested === "string" && (PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : LATEST_PROTOCOL;
}

/** Handle one JSON-RPC message. Returns null for notifications (no reply). */
export async function handleMessage(raw: unknown): Promise<JsonRpcResponse | null> {
  if (!raw || typeof raw !== "object") return fail(null, ERR.invalidRequest, "Invalid request");
  const msg = raw as JsonRpcRequest;
  const id = msg.id ?? null;
  if (typeof msg.method !== "string") return fail(id, ERR.invalidRequest, "Missing method");
  const params = (msg.params ?? {}) as Record<string, unknown>;

  // Notifications carry no id and get no response.
  if (msg.method.startsWith("notifications/")) return null;

  try {
    switch (msg.method) {
      case "initialize":
        return ok(id, {
          protocolVersion: negotiate(params.protocolVersion),
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
          serverInfo: SERVER_INFO,
          instructions: SERVER_INSTRUCTIONS,
        });
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: listTools() });
      case "tools/call": {
        const name = String(params.name ?? "");
        try {
          const result = await callTool(name, params.arguments);
          return ok(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result && typeof result === "object" && !Array.isArray(result) ? result : { result }, isError: false });
        } catch (e) {
          // Tool failures are reported inside the result so the model can recover.
          return ok(id, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
        }
      }
      case "resources/list":
        return ok(id, { resources: listResources() });
      case "resources/read": {
        const uri = String(params.uri ?? "");
        if (uri !== SUMMARY_RESOURCE) return fail(id, ERR.invalidParams, `Unknown resource ${uri}`);
        const summary = await callTool("getWorkspaceSummary", {});
        return ok(id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(summary, null, 2) }] });
      }
      case "resources/templates/list":
        return ok(id, { resourceTemplates: [] });
      default:
        return fail(id, ERR.methodNotFound, `Method not found: ${msg.method}`);
    }
  } catch (e) {
    return fail(id, ERR.internal, e instanceof Error ? e.message : String(e));
  }
}

/** Handle a request body (single message or batch). Returns null when only notifications were sent. */
export async function handleBody(body: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handleMessage))).filter((r): r is JsonRpcResponse => r !== null);
    return out.length ? out : null;
  }
  return handleMessage(body);
}
