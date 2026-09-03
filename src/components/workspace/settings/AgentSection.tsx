"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import type { WorkspaceSettings } from "@/lib/types";
import { Badge, Toggle, useToast } from "@/components/ui";
import { SettingsCard } from "./SettingsCard";
import { useSaveSettings } from "./useSaveSettings";

type AgentStatus = { state: "loading" } | { state: "ready"; configured: boolean; model: string } | { state: "error" };

/** Read-only status from GET /api/agent. */
export function useAgentStatus(): AgentStatus {
  const [status, setStatus] = useState<AgentStatus>({ state: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/agent")
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as { configured?: unknown; model?: unknown };
      })
      .then((json) => {
        if (cancelled) return;
        setStatus({ state: "ready", configured: Boolean(json.configured), model: typeof json.model === "string" && json.model ? json.model : "gemini" });
      })
      .catch(() => {
        if (!cancelled) setStatus({ state: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return status;
}

function StatusBadgeFor({ status }: { status: AgentStatus }) {
  if (status.state === "loading") return <Badge tone="default">Checking…</Badge>;
  if (status.state === "error") return <Badge tone="critical" dot>Unavailable</Badge>;
  return status.configured ? (
    <Badge tone="success" dot>
      Ready
    </Badge>
  ) : (
    <Badge tone="warning" dot>
      Needs API key
    </Badge>
  );
}

export function AgentSection({ settings, readOnly }: { settings: WorkspaceSettings; readOnly: boolean }) {
  const saveSettings = useSaveSettings();
  const toast = useToast();
  const status = useAgentStatus();
  const [autoApprove, setAutoApprove] = useState(settings.agentAutoApprove);
  const [saving, setSaving] = useState(false);
  const dirty = autoApprove !== settings.agentAutoApprove;

  const save = async () => {
    setSaving(true);
    try {
      await saveSettings({ agentAutoApprove: autoApprove });
      toast(autoApprove ? "Auto-apply is on. The agent applies changes without asking." : "Auto-apply is off. The agent asks before changing data.", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save settings", "critical");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsCard onSave={() => void save()} saving={saving} dirty={dirty} readOnly={readOnly} footerNote={dirty ? "Unsaved changes" : undefined}>
      <div className="flex items-start gap-3 rounded-[var(--radius)] border border-border bg-surface-subdued p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-accent-soft text-accent">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-text">Agent status</span>
            <StatusBadgeFor status={status} />
          </div>
          <p className="mt-0.5 text-[12.5px] text-text-secondary">
            {status.state === "loading" && "Checking the agent endpoint…"}
            {status.state === "error" && (
              <>
                The status check at <code className="rounded bg-surface-hover px-1 font-mono text-[12px]">/api/agent</code> failed. Make sure the app server is running.
              </>
            )}
            {status.state === "ready" && (
              <>
                Gemini · <span className="font-mono text-[12px]">{status.model}</span> · {status.configured ? "key found on the server" : "no API key on the server"}
              </>
            )}
          </p>
          {status.state === "ready" && !status.configured && (
            <ol className="mt-2 list-decimal space-y-0.5 pl-4 text-[12.5px] text-text-secondary">
              <li>
                Create a key at{" "}
                <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="text-accent underline">
                  aistudio.google.com/apikey
                </a>
                .
              </li>
              <li>
                Add <code className="rounded bg-surface-hover px-1 font-mono text-[12px]">GOOGLE_GENERATIVE_AI_API_KEY=…</code> to <code className="rounded bg-surface-hover px-1 font-mono text-[12px]">.env.local</code> (see .env.example).
              </li>
              <li>Restart the dev server. Optionally set GEMINI_MODEL to pick a different model.</li>
            </ol>
          )}
        </div>
      </div>

      <Toggle
        label="Auto-apply agent changes"
        help={
          autoApprove
            ? "On: write tools run as soon as the agent calls them. The change is still logged in Activity with the agent as the actor."
            : "Off: every write the agent proposes shows up as an approval card in the chat. Nothing changes until someone clicks Approve; Reject sends the agent back to ask what to change."
        }
        checked={autoApprove}
        onChange={setAutoApprove}
        disabled={readOnly}
      />
      <p className="text-[12px] text-text-tertiary">Reads (search, reports, BOM explosion) never need approval. Viewers cannot approve or auto-apply writes regardless of this setting.</p>
    </SettingsCard>
  );
}
