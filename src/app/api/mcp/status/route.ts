import { listResources, listTools, PROTOCOL_VERSIONS, SERVER_INFO } from "@/lib/mcp/server";
import { firestoreServerConfigured, getServerStore } from "@/lib/mcp/store";
import { ENV_NAMES } from "@/lib/firebase-config";

/** What the Nimbus page shows about the MCP endpoint. */
export async function GET() {
  const { mode, note } = await getServerStore();
  const workspaceId = ENV_NAMES.workspaceId.map((n) => process.env[n]).find(Boolean) ?? "default";
  return Response.json({
    server: SERVER_INFO,
    protocolVersions: PROTOCOL_VERSIONS,
    tokenRequired: Boolean(process.env.CUMULUS_MCP_TOKEN?.trim()),
    mode,
    note,
    workspaceId,
    firestoreServerConfigured: firestoreServerConfigured(),
    tools: listTools().map((t) => ({ name: t.name, title: t.title, description: t.description, readOnly: t.annotations.readOnlyHint })),
    resources: listResources().map((r) => ({ uri: r.uri, title: r.title, description: r.description })),
  });
}
