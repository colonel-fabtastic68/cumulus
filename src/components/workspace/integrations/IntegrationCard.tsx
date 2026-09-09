"use client";

import { AlertTriangle, Plug, Settings2 } from "lucide-react";
import type { Integration } from "@/lib/types";
import { Badge, Button, StatusBadge } from "@/components/ui";
import { formatRelative } from "@/lib/format";
import type { IntegrationDef } from "./catalog";

export function IntegrationMark({ def, size = 40 }: { def: IntegrationDef; size?: number }) {
  return (
    <span aria-hidden style={{ width: size, height: size, background: def.mark.bg, color: def.mark.fg, fontSize: Math.round(size * (def.letter.length > 1 ? 0.34 : 0.42)) }} className="inline-flex shrink-0 items-center justify-center rounded-[10px] font-semibold leading-none">
      {def.letter}
    </span>
  );
}

export function IntegrationCard({ def, integration, onSetUp }: { def: IntegrationDef; integration?: Integration; onSetUp: () => void }) {
  const status = integration?.status ?? "not_connected";
  const connected = status === "connected" || status === "error";
  const where = integration?.config?.shop ?? integration?.config?.siteUrl ?? integration?.config?.account ?? Object.values(integration?.config ?? {})[0];
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <IntegrationMark def={def} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13.5px] font-semibold text-text">{def.name}</h3>
            <StatusBadge status={status} />
            {def.kind === "roadmap" && <Badge tone="default">Roadmap</Badge>}
          </div>
          <p className="mt-1 text-[12.5px] leading-[1.45] text-text-secondary">{def.description}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11.5px] text-text-tertiary">{def.kind === "roadmap" ? "Will sync:" : def.kind === "carrier" ? "Does:" : "Syncs:"}</span>
        {def.syncs.map((s) => (
          <Badge key={s} tone="default">
            {s}
          </Badge>
        ))}
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
            <span>Live sync on the roadmap</span>
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
