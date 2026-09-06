"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, KeyRound, Play, Plug } from "lucide-react";
import { Badge, Button, Card, CardHeader, Segmented, Select, SimpleTable, TextField, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";

interface McpStatus {
  server: { name: string; title: string; version: string };
  protocolVersions: string[];
  tokenRequired: boolean;
  mode: "demo" | "firestore";
  note: string;
  workspaceId: string;
  firestoreServerConfigured: boolean;
  tools: Array<{ name: string; title: string; description: string; readOnly: boolean }>;
  resources: Array<{ uri: string; title: string; description: string }>;
}

type Snippet = "claude-code" | "json" | "curl";

const TRY_TOOLS: Array<{ label: string; name: string; args: Record<string, unknown> }> = [
  { label: "Workspace summary", name: "getWorkspaceSummary", args: {} },
  { label: "Low-stock report", name: "getReport", args: { report: "lowStock", limit: 10 } },
  { label: "Search: items below minimum", name: "searchItems", args: { filter: { belowMin: true }, limit: 10 } },
  { label: "Explode BOM: 5 × FG-OD1-BLK", name: "explodeBom", args: { sku: "FG-OD1-BLK", qty: 5 } },
];

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return "cmls_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * "Connect other agents": groundwork for the Cumulus MCP endpoint. Shows the
 * URL, how to connect from common agent hosts, the tool set (the same one
 * Nimbus uses), token setup, and a live call so the demo can be exercised.
 */
export function McpCard() {
  const toast = useToast();
  const [status, setStatus] = useState<McpStatus | null | "error">(null);
  const [snippet, setSnippet] = useState<Snippet>("claude-code");
  const [token, setToken] = useState("");
  const [generated, setGenerated] = useState<string | null>(null);
  const [tryTool, setTryTool] = useState(TRY_TOOLS[0]!.name);
  const [running, setRunning] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/mcp/status")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: McpStatus) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const endpoint = useMemo(() => (typeof window !== "undefined" ? `${window.location.origin}/api/mcp` : "/api/mcp"), []);
  const tokenValue = token.trim() || generated || "<CUMULUS_MCP_TOKEN>";
  const info = status && status !== "error" ? status : null;

  const snippets: Record<Snippet, string> = {
    "claude-code": `claude mcp add --transport http cumulus ${endpoint}${info?.tokenRequired || token || generated ? ` --header "Authorization: Bearer ${tokenValue}"` : ""}`,
    json: JSON.stringify(
      {
        mcpServers: {
          cumulus: {
            url: endpoint,
            ...(info?.tokenRequired || token || generated ? { headers: { Authorization: `Bearer ${tokenValue}` } } : {}),
          },
        },
      },
      null,
      2,
    ),
    curl: `curl -s ${endpoint} \\\n  -H 'Content-Type: application/json'${info?.tokenRequired || token || generated ? ` \\\n  -H 'Authorization: Bearer ${tokenValue}'` : ""} \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"getWorkspaceSummary","arguments":{}}}'`,
  };

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500);
    } catch {
      toast("Copy failed. Select the text and copy it manually.", "critical");
    }
  };

  const run = async () => {
    const t = TRY_TOOLS.find((x) => x.name === tryTool)!;
    setRunning(true);
    setOutput(null);
    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name: t.name, arguments: t.args } }),
      });
      const json = await res.json();
      if (!res.ok) {
        setOutput(JSON.stringify(json, null, 2));
        return;
      }
      const text = json?.result?.content?.[0]?.text ?? JSON.stringify(json, null, 2);
      setOutput(text.length > 6000 ? text.slice(0, 6000) + "\n…" : text);
    } catch (e) {
      setOutput(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <Plug className="h-4 w-4 text-icon" /> Connect other agents (MCP)
          </span>
        }
        subtitle="Cumulus speaks the Model Context Protocol, so Claude Code, Claude Desktop, Cursor or your own agents can query this workspace and run the same tools Nimbus uses."
        actions={
          info ? (
            <>
              <Badge tone={info.mode === "demo" ? "attention" : "success"}>{info.mode === "demo" ? "Demo dataset" : `Workspace ${info.workspaceId}`}</Badge>
              <Badge tone={info.tokenRequired ? "success" : "default"}>{info.tokenRequired ? "Token required" : "Open (demo)"}</Badge>
            </>
          ) : status === "error" ? (
            <Badge tone="critical">Endpoint unavailable</Badge>
          ) : null
        }
      />

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3">
            <div>
              <div className="mb-1 text-[12px] font-[550] text-text-secondary">Endpoint</div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-[8px] bg-surface-subdued px-2.5 py-1.5 font-mono text-[12px]">{endpoint}</code>
                <Button size="sm" icon={copied === "endpoint" ? <Check /> : <Copy />} onClick={() => copy("endpoint", endpoint)}>
                  Copy
                </Button>
              </div>
              {info && <p className="mt-1 text-[12px] text-text-tertiary">{info.note}</p>}
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <div className="text-[12px] font-[550] text-text-secondary">Connect from</div>
                <Segmented
                  value={snippet}
                  onChange={setSnippet}
                  options={[
                    { value: "claude-code", label: "Claude Code" },
                    { value: "json", label: "Desktop / Cursor" },
                    { value: "curl", label: "curl" },
                  ]}
                />
              </div>
              <div className="relative">
                <pre className="overflow-x-auto rounded-[8px] bg-[#303030] p-3 pr-16 font-mono text-[12px] leading-5 text-[#f1f1f1]">{snippets[snippet]}</pre>
                <Button size="sm" className="absolute right-2 top-2" icon={copied === snippet ? <Check /> : <Copy />} onClick={() => copy(snippet, snippets[snippet])}>
                  Copy
                </Button>
              </div>
            </div>

            <div className="rounded-[8px] border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[13px] font-[550] text-text">Access token</div>
                  <p className="text-[12px] text-text-secondary">Set <code>CUMULUS_MCP_TOKEN</code> on the server (.env.local locally, Environment Variables on Vercel) and the endpoint requires it as a bearer token. Without it, only the demo dataset is served.</p>
                </div>
                <Button size="sm" icon={<KeyRound />} onClick={() => setGenerated(randomToken())}>
                  Generate
                </Button>
              </div>
              {generated && (
                <div className="mt-2 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-[8px] bg-surface-subdued px-2.5 py-1.5 font-mono text-[12px]">CUMULUS_MCP_TOKEN={generated}</code>
                  <Button size="sm" icon={copied === "token" ? <Check /> : <Copy />} onClick={() => copy("token", `CUMULUS_MCP_TOKEN=${generated}`)}>
                    Copy
                  </Button>
                </div>
              )}
              <TextField containerClassName="mt-2" label="Token for the test call below" hint="(only if the server requires one)" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="cmls_…" />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <div className="mb-1.5 text-[12px] font-[550] text-text-secondary">Try it</div>
              <div className="flex flex-wrap items-end gap-2">
                <Select label="Tool call" value={tryTool} onChange={(e) => setTryTool(e.target.value)} options={TRY_TOOLS.map((t) => ({ value: t.name, label: t.label }))} containerClassName="min-w-[240px] flex-1" />
                <Button variant="primary" icon={<Play />} loading={running} onClick={run} disabled={status === "error"}>
                  Run via MCP
                </Button>
              </div>
              <pre className={cn("mt-2 max-h-72 overflow-auto rounded-[8px] bg-surface-subdued p-3 font-mono text-[11.5px] leading-4 text-text-secondary", !output && "flex items-center justify-center text-text-tertiary")}>
                {output ?? "The response from POST /api/mcp will appear here."}
              </pre>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-[12px] font-[550] text-text-secondary">Tools exposed{info ? ` · ${info.tools.length}` : ""}</div>
            {info && <span className="text-[12px] text-text-tertiary">Protocol {info.protocolVersions[0]}</span>}
          </div>
          <SimpleTable className="max-h-64 overflow-y-auto">
            <thead>
              <tr>
                <th>Tool</th>
                <th>What it does</th>
                <th className="w-24">Access</th>
              </tr>
            </thead>
            <tbody>
              {info ? (
                info.tools.map((t) => (
                  <tr key={t.name}>
                    <td className="whitespace-nowrap font-mono text-[12px]">{t.name}</td>
                    <td className="text-text-secondary">{t.description}</td>
                    <td>
                      <Badge tone={t.readOnly ? "default" : "attention"}>{t.readOnly ? "Read" : "Write"}</Badge>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-text-tertiary">
                    {status === "error" ? "The MCP endpoint did not respond." : "Loading…"}
                  </td>
                </tr>
              )}
            </tbody>
          </SimpleTable>
          <p className="mt-2 text-[12px] text-text-tertiary">
            The endpoint is stateless JSON-RPC over HTTP. With <code>FIREBASE_SERVICE_ACCOUNT_JSON</code> set on the server it serves the live workspace (badge shows the workspace id); otherwise an in-memory demo, so nothing real is exposed by accident.
          </p>
        </div>
      </div>
    </Card>
  );
}
