"use client";

import { useMemo } from "react";
import { AlertTriangle, Hammer, Layers } from "lucide-react";
import type { Build, Item } from "@/lib/types";
import { formatNumber, pluralize } from "@/lib/format";
import { Stat } from "@/components/ui";
import { computeBuildStats, WINDOW_DAYS } from "./buildUtils";

export function BuildStats({ builds, items }: { builds: Build[]; items: Item[] }) {
  const stats = useMemo(() => computeBuildStats(builds, items), [builds, items]);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Stat label="Units built" value={formatNumber(stats.unitsBuilt)} hint={`Last ${WINDOW_DAYS} days · finished units on the shelf`} tone={stats.unitsBuilt > 0 ? "success" : "default"} icon={<Layers />} />
      <Stat label="Builds" value={formatNumber(stats.buildCount)} hint={`Last ${WINDOW_DAYS} days`} icon={<Hammer />} />
      <Stat
        label="Assemblies below minimum"
        value={formatNumber(stats.belowMin)}
        hint={stats.belowMin > 0 ? `of ${pluralize(stats.assemblyCount, "buildable assembly", "buildable assemblies")} need a build` : "Every assembly is at or above its minimum"}
        tone={stats.belowMin > 0 ? "warning" : "default"}
        icon={<AlertTriangle />}
      />
    </div>
  );
}
