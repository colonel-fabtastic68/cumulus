"use client";

import { useMemo, useState } from "react";
import type { WorkspaceSettings } from "@/lib/types";
import { FEATURES, FEATURE_IDS, featureDefault, featureEnabled, featureStatus, featureSwitchable, type FeatureArea, type FeatureId, type FeatureStatus, type ReleaseStage } from "@/lib/features";
import { useFeatureContext } from "@/lib/useFeature";
import { Badge, Toggle, useToast, type BadgeTone } from "@/components/ui";
import { SettingsCard } from "./SettingsCard";
import { useSaveSettings } from "./useSaveSettings";

const STATUS: Record<FeatureStatus, { label: string; tone: BadgeTone }> = {
  planned: { label: "Planned", tone: "default" },
  preview: { label: "Preview", tone: "attention" },
  beta: { label: "Beta", tone: "info" },
  released: { label: "Released", tone: "success" },
};

const AREAS: FeatureArea[] = ["Catalog", "Inventory", "Orders", "Purchasing", "Production", "Printing and labels", "Reports", "Accounting", "Data"];

/** Features a workspace can see in Labs on this deployment: everything in staging, only what it may switch in production. */
export function labsFeatures(stage: ReleaseStage): FeatureId[] {
  return FEATURE_IDS.filter((id) => (stage === "production" ? featureSwitchable(id, stage) : featureStatus(id) !== "released"));
}

/**
 * Settings → Labs: unreleased features (src/lib/features.ts) and this
 * workspace's switch for each. In staging everything in preview is on unless
 * switched off here; in production only beta features appear, off until switched on.
 */
export function LabsSection({ settings, readOnly }: { settings: WorkspaceSettings; readOnly: boolean }) {
  const saveSettings = useSaveSettings();
  const toast = useToast();
  const ctx = useFeatureContext();
  const [saving, setSaving] = useState<FeatureId | null>(null);
  const ids = useMemo(() => labsFeatures(ctx.stage), [ctx.stage]);
  const groups = useMemo(() => AREAS.map((area) => ({ area, ids: ids.filter((id) => FEATURES[id].area === area) })).filter((g) => g.ids.length > 0), [ids]);
  const onCount = ids.filter((id) => featureEnabled(id, ctx)).length;

  const set = async (id: FeatureId, on: boolean) => {
    setSaving(id);
    try {
      const next = { ...(settings.features ?? {}) };
      // Back at the default there is nothing to remember.
      if (on === featureDefault(id, ctx)) delete next[id];
      else next[id] = on;
      await saveSettings({ features: next });
      toast(`${FEATURES[id].label} is ${on ? "on" : "off"}`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save the switch", "critical");
    } finally {
      setSaving(null);
    }
  };

  return (
    <SettingsCard>
      <p className="text-[12.5px] text-text-secondary">
        {ctx.stage === "production"
          ? "Features that are ready to try before everyone gets them. Switching one on changes this workspace only."
          : `This is the ${ctx.stage === "staging" ? "staging" : "development"} build: features in preview are on here and hidden on cumulusos.com until they are released. Switch one off to compare with today's product.`}{" "}
        {onCount} of {ids.length} on.
      </p>
      {groups.map((g) => (
        <div key={g.area}>
          <h3 className="mb-1 text-[12.5px] font-semibold text-text">{g.area}</h3>
          <div className="divide-y divide-border rounded-[var(--radius)] border border-border">
            {g.ids.map((id) => {
              const def = FEATURES[id];
              const status = STATUS[featureStatus(id)];
              const switchable = featureSwitchable(id, ctx.stage);
              return (
                <div key={id} className="flex items-start justify-between gap-4 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-medium text-text">{def.label}</span>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <p className="mt-0.5 text-[12px] text-text-tertiary">{def.description}</p>
                  </div>
                  {switchable ? (
                    <Toggle size="sm" checked={featureEnabled(id, ctx)} onChange={(v) => void set(id, v)} disabled={readOnly || saving === id} aria-label={def.label} className="mt-0.5" />
                  ) : (
                    <span className="mt-0.5 shrink-0 text-[12px] text-text-tertiary">Not built yet</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </SettingsCard>
  );
}
