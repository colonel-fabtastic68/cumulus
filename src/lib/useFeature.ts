"use client";

import { useMemo } from "react";
import { getRuntimeConfig } from "@/lib/firebase-config";
import { FEATURE_IDS, featureEnabled, type FeatureContext, type FeatureId } from "@/lib/features";
import { useSettings } from "@/lib/store/provider";

/** The stage, deployment-wide switches and this workspace's own choices: everything a flag check needs. */
export function useFeatureContext(): FeatureContext {
  const overrides = useSettings().features;
  const { stage, features } = getRuntimeConfig();
  return useMemo(() => ({ stage: stage ?? "production", forced: features, overrides }), [stage, features, overrides]);
}

/** Whether an unreleased feature (src/lib/features.ts) is on for this workspace on this deployment. */
export function useFeature(id: FeatureId): boolean {
  return featureEnabled(id, useFeatureContext());
}

/** Every flag at once, for components that check several. */
export function useFeatures(): Record<FeatureId, boolean> {
  const ctx = useFeatureContext();
  return useMemo(() => Object.fromEntries(FEATURE_IDS.map((id) => [id, featureEnabled(id, ctx)])) as Record<FeatureId, boolean>, [ctx]);
}
