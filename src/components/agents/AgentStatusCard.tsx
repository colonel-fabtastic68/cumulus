"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Badge, Banner, Card, Toggle, useToast } from "@/components/ui";
import { useSettings } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useSaveSettings } from "./useSaveSettings";

type AgentStatus = { state: "loading" } | { state: "ready"; configured: boolean; model: string } | { state: "error" };

export function AgentStatusCard() {
  const settings = useSettings();
  const user = useCurrentUser();
  const toast = useToast();
  const saveSettings = useSaveSettings();
  const [status, setStatus] = useState<AgentStatus>({ state: "loading" });
  const [saving, setSaving] = useState(false);

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

  const writable = canWrite(user);

  const onToggleAutoApply = async (next: boolean) => {
    setSaving(true);
    try {
      await saveSettings({ agentAutoApprove: next });
      toast(next ? "Auto-apply is on. The agent will apply changes without asking." : "Auto-apply is off. The agent will ask before changing data.", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update settings", "critical");
    } finally {
      setSaving(false);
    }
  };

  const notConfigured = status.state === "ready" && !status.configured;

  return (
    <div className="flex flex-col gap-3">
      {notConfigured && (
        <Banner tone="warning" title="Add a Gemini API key to enable the agent">
          <ol className="mt-1 list-decimal space-y-0.5 pl-4">
            <li>
              Get a key at <span className="font-medium">aistudio.google.com/apikey</span>
            </li>
            <li>
              Add <code className="rounded bg-surface-hover px-1 font-mono text-[12px]">GOOGLE_GENERATIVE_AI_API_KEY=…</code> to <code className="rounded bg-surface-hover px-1 font-mono text-[12px]">.env.local</code>
            </li>
            <li>Restart the dev server</li>
          </ol>
        </Banner>
      )}
      {status.state === "error" && (
        <Banner tone="critical" title="Could not reach the agent API">
          The status check at <code className="rounded bg-surface-hover px-1 font-mono text-[12px]">/api/agent</code> failed. Make sure the dev server is running.
        </Banner>
      )}
      <Card className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-accent-soft text-accent">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold text-text">
              {status.state === "loading" && <span>Checking agent…</span>}
              {status.state === "error" && <span>Agent status unknown</span>}
              {status.state === "ready" && (
                <span className="truncate">
                  Gemini · {status.model} · {status.configured ? "ready" : "not configured"}
                </span>
              )}
              {status.state === "ready" && (status.configured ? <Badge tone="success" dot>Ready</Badge> : <Badge tone="warning" dot>Needs API key</Badge>)}
              {status.state === "loading" && <Badge tone="default">Checking</Badge>}
              {status.state === "error" && <Badge tone="critical">Unreachable</Badge>}
            </div>
            <p className="mt-0.5 text-[12.5px] text-text-secondary">
              {settings.agentAutoApprove ? "Auto-apply is on: write actions run as soon as the agent proposes them." : "Auto-apply is off: every write action waits for your approval in the panel."}
            </p>
          </div>
        </div>
        <div className="shrink-0 sm:border-l sm:border-border sm:pl-4">
          <Toggle
            label="Auto-apply changes"
            help={writable ? "Skip the approval step for write actions" : "Viewers cannot change this"}
            checked={settings.agentAutoApprove}
            onChange={onToggleAutoApply}
            disabled={!writable || saving}
          />
        </div>
      </Card>
    </div>
  );
}
