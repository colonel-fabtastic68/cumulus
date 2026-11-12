"use client";

import { useMemo } from "react";
import { useSettings } from "@/lib/store/provider";
import { useFeature } from "@/lib/useFeature";
import { termsFor, type Terms } from "@/lib/terminology";

/** The workspace's own words for things (src/lib/terminology.ts). */
export function useTerms(): Terms {
  const terminology = useSettings().terminology;
  const enabled = useFeature("partNumbers");
  return useMemo(() => termsFor({ terminology }, enabled), [terminology, enabled]);
}
