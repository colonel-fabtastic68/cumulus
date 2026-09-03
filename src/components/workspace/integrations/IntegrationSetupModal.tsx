"use client";

import { useState } from "react";
import { ArrowRight, Download } from "lucide-react";
import type { Integration } from "@/lib/types";
import { Banner, Button, Modal, StatusBadge, TextField, useToast } from "@/components/ui";
import { useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { nowIso } from "@/lib/utils";
import type { IntegrationDef } from "./catalog";
import { IntegrationMark } from "./IntegrationCard";

/**
 * Gate: mounts the form only while open so its state resets per platform.
 */
export function IntegrationSetupModal({ open, onClose, def, integration }: { open: boolean; onClose: () => void; def?: IntegrationDef; integration?: Integration }) {
  if (!open || !def) return null;
  return <SetupForm key={def.id} def={def} integration={integration} onClose={onClose} />;
}

function SetupForm({ def, integration, onClose }: { def: IntegrationDef; integration?: Integration; onClose: () => void }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const writable = canWrite(user);
  const [storeUrl, setStoreUrl] = useState(integration?.config?.storeUrl ?? "");
  const [saving, setSaving] = useState(false);

  const dirty = storeUrl.trim() !== (integration?.config?.storeUrl ?? "");

  const save = async () => {
    setSaving(true);
    try {
      const config: Record<string, string> = { ...(integration?.config ?? {}) };
      const trimmed = storeUrl.trim();
      if (trimmed) config.storeUrl = trimmed;
      else delete config.storeUrl;
      if (integration) {
        await store.patch("integrations", def.id, { config });
      } else {
        await store.put("integrations", { id: def.id, status: "not_connected", config, createdAt: nowIso() });
      }
      toast(trimmed ? `${def.name} details saved` : `${def.name} details cleared`, "success");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "critical");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <span className="inline-flex items-center gap-2">
          <IntegrationMark def={def} size={24} />
          Set up {def.name}
          <StatusBadge status={integration?.status ?? "not_connected"} />
        </span>
      }
      subtitle="Save your store details now and use CSV exports until live sync ships."
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!writable || !dirty}>
            Save details
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Banner tone="info" title="Live sync is on the roadmap">
          Cumulus does not talk to {def.name} yet. Nothing you enter here is sent anywhere; it is stored with the workspace so the connection is ready to switch on later. Once live, it will sync{" "}
          {def.syncs.map((s) => s.toLowerCase()).join(", ")}.
        </Banner>

        <TextField
          label={def.url.label}
          placeholder={def.url.placeholder}
          value={storeUrl}
          onChange={(e) => setStoreUrl(e.target.value)}
          help={writable ? def.url.help : "Viewers cannot save integration details."}
          disabled={!writable}
          autoFocus={writable}
        />

        <div className="rounded-[var(--radius)] border border-border bg-surface-subdued p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="text-[13px] font-semibold text-text">Available now: CSV export from {def.name}</h4>
              <p className="mt-0.5 text-[12.5px] text-text-secondary">A product export imports in under a minute and updates existing items by SKU.</p>
            </div>
            <Button size="sm" variant="primary" href="/import" icon={<Download />} iconRight={<ArrowRight />}>
              Go to Import
            </Button>
          </div>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-[12.5px] text-text-secondary">
            {def.export.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <div className="mt-3 text-[11.5px] font-semibold uppercase tracking-wide text-text-tertiary">Expected header row</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {def.export.headers.map((h) => (
              <code key={h} className="rounded-[4px] border border-border bg-surface px-1.5 py-0.5 font-mono text-[11.5px] text-text-secondary">
                {h}
              </code>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-text-tertiary">{def.export.note}</p>
        </div>
      </div>
    </Modal>
  );
}
