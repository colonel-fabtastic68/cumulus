"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Hammer, Plus, Upload } from "lucide-react";
import type { Item } from "@/lib/types";
import { useCollection, useItems, useItemsById } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { Button, Page, QueryParamEffect } from "@/components/ui";
import { useFeature } from "@/lib/useFeature";
import { BuildModal, ItemFormModal } from "@/components/inventory";
import { AssembliesTable, BuildDetailModal, BuildHistoryTable, BuildStats, CopyBomModal, isBuildableAssembly } from "@/components/builds";

/** What the item form starts from when it is opened as New assembly. */
const NEW_ASSEMBLY: Partial<Item> = { type: "assembly" };

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
  const [copySource, setCopySource] = useState<Item | null>(null);
  // Feature `newAssembly`: create an assembly from here, then list its parts on its BOM tab.
  const router = useRouter();
  const canCreate = useFeature("newAssembly") && writable;
  const [newOpen, setNewOpen] = useState(false);
  // Feature `bomImport`: parts lists from a spreadsheet, through the Import page.
  const canImport = useFeature("bomImport") && writable;

  // Feature `assembliesWithoutBom`: active assemblies with no parts yet are listed too, so they can be set up from here.
  const showUnbuilt = useFeature("assembliesWithoutBom");
  const assemblies = useMemo(() => items.filter((i) => isBuildableAssembly(i) || (showUnbuilt && i.type === "assembly" && i.status === "active" && i.bom.length === 0)), [items, showUnbuilt]);
  const selected = useMemo(() => (selectedId ? (builds.find((b) => b.id === selectedId) ?? null) : null), [builds, selectedId]);

  const selectedSkus = useMemo(() => {
    const sku = selected ? itemsById.get(selected.assemblyId)?.sku : buildTarget?.assembly?.sku;
    return sku ? [sku] : undefined;
  }, [selected, buildTarget, itemsById]);

  useEffect(() => {
    setPageContext({ page: "BOM", selectedSkus });
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
    <Page
      title="BOM"
      subtitle="Bills of materials: what each assembly is made of, what you can build now, and what has been built"
      primaryAction={buildButton}
      secondaryActions={
        canCreate || canImport ? (
          <>
            {canImport && (
              <Button icon={<Upload />} href="/import?kind=boms">
                Import BOMs
              </Button>
            )}
            {canCreate && (
              <Button icon={<Plus />} onClick={() => setNewOpen(true)}>
                New assembly
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      <Suspense fallback={null}>
        <QueryParamEffect param="highlight" onValue={setSelectedId} />
      </Suspense>
      <div className="flex flex-col gap-4">
        <BuildStats builds={builds} items={items} />
        <AssembliesTable items={items} assemblies={assemblies} canWrite={writable} onBuild={openBuild} onCopyBom={setCopySource} onNew={canCreate ? () => setNewOpen(true) : undefined} />
        <CopyBomModal source={copySource} onClose={() => setCopySource(null)} />
        <BuildHistoryTable builds={builds} onSelect={(b) => setSelectedId(b.id)} onNew={writable ? () => openBuild(null) : undefined} />
      </div>

      <BuildModal open={!!buildTarget} onClose={() => setBuildTarget(null)} assembly={buildTarget?.assembly ?? null} />
      <BuildDetailModal build={selected} onClose={() => setSelectedId(null)} />
      {/* Saving goes straight to the new assembly's BOM tab, where its parts are listed. */}
      <ItemFormModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        defaults={NEW_ASSEMBLY}
        title="New assembly"
        submitLabel="Create and add parts"
        onSaved={(item) => router.push(item.type === "assembly" ? `/inventory/${item.id}?tab=bom` : `/inventory/${item.id}`)}
      />
    </Page>
  );
}
