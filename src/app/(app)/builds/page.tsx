"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Hammer } from "lucide-react";
import type { Item } from "@/lib/types";
import { useCollection, useItems, useItemsById } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { Button, Page, QueryParamEffect } from "@/components/ui";
import { BuildModal } from "@/components/inventory";
import { AssembliesTable, BuildDetailModal, BuildHistoryTable, BuildStats, isBuildableAssembly } from "@/components/builds";

export default function BuildsPage() {
  const items = useItems();
  const itemsById = useItemsById();
  const builds = useCollection("builds");
  const user = useCurrentUser();
  const writable = canWrite(user);
  const { setPageContext } = useAgent();

  /** null = closed; { assembly: null } = open with no preset assembly. */
  const [buildTarget, setBuildTarget] = useState<{ assembly: Item | null } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const assemblies = useMemo(() => items.filter(isBuildableAssembly), [items]);
  const selected = useMemo(() => (selectedId ? (builds.find((b) => b.id === selectedId) ?? null) : null), [builds, selectedId]);

  const selectedSkus = useMemo(() => {
    const sku = selected ? itemsById.get(selected.assemblyId)?.sku : buildTarget?.assembly?.sku;
    return sku ? [sku] : undefined;
  }, [selected, buildTarget, itemsById]);

  useEffect(() => {
    setPageContext({ page: "Builds", selectedSkus });
  }, [setPageContext, selectedSkus]);


  const openBuild = useCallback(
    (assembly: Item | null) => {
      if (!writable) return;
      setBuildTarget({ assembly });
    },
    [writable],
  );

  const buildButton = writable ? (
    <Button variant="primary" icon={<Hammer />} onClick={() => openBuild(null)}>
      Build assembly
    </Button>
  ) : undefined;

  return (
    <Page title="Builds" subtitle="Turn components into assemblies and finished goods" primaryAction={buildButton}>
      <Suspense fallback={null}>
        <QueryParamEffect param="highlight" onValue={setSelectedId} />
      </Suspense>
      <div className="flex flex-col gap-4">
        <BuildStats builds={builds} items={items} />
        <AssembliesTable items={items} assemblies={assemblies} canWrite={writable} onBuild={openBuild} />
        <BuildHistoryTable builds={builds} onSelect={(b) => setSelectedId(b.id)} onNew={writable ? () => openBuild(null) : undefined} />
      </div>

      <BuildModal open={!!buildTarget} onClose={() => setBuildTarget(null)} assembly={buildTarget?.assembly ?? null} />
      <BuildDetailModal build={selected} onClose={() => setSelectedId(null)} />
    </Page>
  );
}
