"use client";

import { AlertTriangle, Plug, Settings2 } from "lucide-react";
import type { Integration } from "@/lib/types";
import { Badge, Button, StatusBadge } from "@/components/ui";
import { formatRelative } from "@/lib/format";
import type { IntegrationDef } from "./catalog";

export function IntegrationCard({ def, integration, onSetUp }: { def: IntegrationDef; integration?: Integration; onSetUp: () => void }) {
  const status = integration?.status ?? "not_connected";
  const connected = status === "connected" || status === "error";
  const where = integration?.config?.shop ?? integration?.config?.siteUrl ?? integration?.config?.companyName ?? integration?.config?.businessName ?? integration?.config?.account ?? Object.values(integration?.config ?? {})[0];
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[13.5px] font-semibold text-text">{def.name}</h3>
          <StatusBadge status={status} />
          {def.kind === "roadmap" && <Badge tone="default">Roadmap</Badge>}
          {def.stage === "in_progress" && <Badge tone="attention">In progress</Badge>}
          {def.stage === "live" && <Badge tone="success">Live</Badge>}
          {connected && integration?.config?.environment === "sandbox" && <Badge tone="attention">Sandbox</Badge>}
        </div>
        <p className="mt-1 text-[12.5px] leading-[1.45] text-text-secondary">{def.description}</p>
      </div>
      {integration?.lastError && (
        <p className="flex items-start gap-1.5 text-[12px] text-critical">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="line-clamp-2">{integration.lastError}</span>
        </p>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="min-w-0 text-[12px] text-text-tertiary">
          {connected && where ? (
            <span className="block truncate" title={where}>
              <span className="font-mono text-[11.5px] text-text-secondary">{where}</span>
              {integration?.lastSyncAt ? ` · synced ${formatRelative(integration.lastSyncAt)}` : ""}
            </span>
          ) : where ? (
            <span className="block truncate" title={where}>
              Saved: <span className="font-mono text-[11.5px] text-text-secondary">{where}</span>
            </span>
          ) : def.kind === "roadmap" ? (
            <span>{def.stage === "in_progress" ? "Being built" : "Live sync on the roadmap"}</span>
          ) : (
            <span>Not connected</span>
          )}
        </div>
        <Button size="sm" variant={connected || def.kind === "roadmap" ? "secondary" : "primary"} icon={connected || def.kind === "roadmap" ? <Settings2 /> : <Plug />} onClick={onSetUp}>
          {connected ? "Manage" : def.kind === "roadmap" ? "Set up" : "Connect"}
        </Button>
      </div>
    </div>
  );
}
