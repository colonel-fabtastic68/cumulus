"use client";

import { useCallback } from "react";
import type { WorkspaceSettings } from "@/lib/types";
import { useCollection, useSettings, useStore } from "@/lib/store/provider";
import { nowIso } from "@/lib/utils";

export type SettingsPatch = Partial<Omit<WorkspaceSettings, "id" | "updatedAt">>;

/**
 * Patch the workspace settings document, stamping updatedAt.
 * Falls back to creating the document when the workspace has none yet
 * (a local patch on a missing doc is a silent no-op).
 */
export function useSaveSettings(): (patch: SettingsPatch) => Promise<void> {
  const store = useStore();
  const settings = useSettings();
  const rows = useCollection("settings");
  const exists = rows.some((r) => r.id === "default");
  return useCallback(
    async (patch: SettingsPatch) => {
      const updatedAt = nowIso();
      if (exists) await store.patch("settings", "default", { ...patch, updatedAt });
      else await store.put("settings", { ...settings, ...patch, id: "default", updatedAt });
    },
    [store, settings, exists],
  );
}
