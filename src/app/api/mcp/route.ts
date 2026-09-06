import { handleBody, LATEST_PROTOCOL, PROTOCOL_VERSIONS, SERVER_INFO } from "@/lib/mcp/server";

export const maxDuration = 60;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Accept",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
};

/** A bearer token is required when CUMULUS_MCP_TOKEN is set; otherwise the demo dataset is open. */
function tokenRequired(): boolean {
  return Boolean(process.env.CUMULUS_MCP_TOKEN?.trim());
}

function authorized(req: Request): boolean {
  const expected = process.env.CUMULUS_MCP_TOKEN?.trim();
  if (!expected) return true;
  const header = req.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const alt = req.headers.get("x-cumulus-token")?.trim() ?? "";
  return bearer === expected || alt === expected;
}

function unauthorized() {
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized: send Authorization: Bearer <CUMULUS_MCP_TOKEN>" } },
    { status: 401, headers: { ...CORS, "WWW-Authenticate": 'Bearer realm="cumulus-mcp"' } },
  );
}

/** JSON-RPC over Streamable HTTP. Responses are plain JSON (no server-initiated streams). */
export async function POST(req: Request) {
  if (!authorized(req)) return unauthorized();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: CORS });
  }
  const result = await handleBody(body);
  if (result === null) return new Response(null, { status: 202, headers: CORS });
  return Response.json(result, { headers: { ...CORS, "Mcp-Protocol-Version": LATEST_PROTOCOL } });
}

/** No server-push stream yet; describe the endpoint for humans and probes. */
export async function GET(req: Request) {
  if ((req.headers.get("accept") ?? "").includes("text/event-stream")) {
    return new Response("This server does not open server-initiated streams. Send JSON-RPC requests with POST.", { status: 405, headers: { ...CORS, Allow: "POST, DELETE, OPTIONS" } });
  }
  return Response.json({ ...SERVER_INFO, transport: "streamable-http", protocolVersions: PROTOCOL_VERSIONS, tokenRequired: tokenRequired(), usage: "POST JSON-RPC 2.0 messages (initialize, tools/list, tools/call, resources/list, resources/read) to this URL." }, { headers: CORS });
}

export async function DELETE() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}
