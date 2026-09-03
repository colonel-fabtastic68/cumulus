"use client";

import { Settings2 } from "lucide-react";
import type { Integration } from "@/lib/types";
import { Badge, Button, StatusBadge } from "@/components/ui";
import { formatRelative } from "@/lib/format";
import type { IntegrationDef } from "./catalog";

export function IntegrationMark({ def, size = 40 }: { def: IntegrationDef; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, background: def.mark.bg, color: def.mark.fg, fontSize: Math.round(size * 0.42) }}
      className="inline-flex shrink-0 items-center justify-center rounded-[10px] font-semibold leading-none"
    >
      {def.letter}
    </span>
  );
}

export function IntegrationCard({ def, integration, onSetUp }: { def: IntegrationDef; integration?: Integration; onSetUp: () => void }) {
  const status = integration?.status ?? "not_connected";
  const storeUrl = integration?.config?.storeUrl;
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <IntegrationMark def={def} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13.5px] font-semibold text-text">{def.name}</h3>
            <StatusBadge status={status} />
          </div>
          <p className="mt-1 text-[12.5px] leading-[1.45] text-text-secondary">{def.description}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11.5px] text-text-tertiary">Will sync:</span>
        {def.syncs.map((s) => (
          <Badge key={s} tone="default">
            {s}
          </Badge>
        ))}
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="min-w-0 text-[12px] text-text-tertiary">
          {storeUrl ? (
            <span className="block truncate" title={storeUrl}>
              Saved: <span className="font-mono text-[11.5px] text-text-secondary">{storeUrl}</span>
            </span>
          ) : integration?.lastSyncAt ? (
            <span>Last sync {formatRelative(integration.lastSyncAt)}</span>
          ) : (
            <span>Live sync on the roadmap</span>
          )}
        </div>
        <Button size="sm" icon={<Settings2 />} onClick={onSetUp}>
          Set up
        </Button>
      </div>
    </div>
  );
}
