"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Plus } from "lucide-react";
import type { Item } from "@/lib/types";
import { useCollection, useItems } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { Button, Page, QueryParamEffect, Stat } from "@/components/ui";
import { TransferDetailModal, TransferDrawer, TransfersTable, transferUnits } from "@/components/transfers";
import { formatNumber } from "@/lib/format";

export default function TransfersPage() {
  const transfers = useCollection("transfers");
  const items = useItems();
  const user = useCurrentUser();
  const writable = canWrite(user);
  const { setPageContext } = useAgent();
  const [creating, setCreating] = useState<{ items?: Item[] } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setPageContext({ page: "Transfers" });
  }, [setPageContext]);

  // "?sku=ENC-125B" opens the drawer with that item on the first line (item pages and scan results link here).
  const onSkuParam = useCallback(
    (sku: string) => {
      const item = items.find((i) => i.sku.toUpperCase() === sku.toUpperCase());
      if (item && writable) setCreating((c) => (c?.items?.[0]?.id === item.id ? c : { items: [item] }));
    },
    [items, writable],
  );

  const selected = useMemo(() => transfers.find((t) => t.id === selectedId) ?? null, [transfers, selectedId]);
  const inTransit = useMemo(() => transfers.filter((t) => t.status === "in_transit"), [transfers]);
  const unitsInTransit = useMemo(() => inTransit.reduce((a, t) => a + transferUnits(t), 0), [inTransit]);

  return (
    <Page
      title="Transfers"
      subtitle="Stock moving between locations. In transit it is on hand at neither end."
      primaryAction={
        writable ? (
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating({})}>
            New transfer
          </Button>
        ) : undefined
      }
    >
      <Suspense fallback={null}>
        <QueryParamEffect param="sku" onValue={onSkuParam} />
      </Suspense>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 @xl:grid-cols-3">
          <Stat label="In transit" value={formatNumber(inTransit.length)} hint={`${formatNumber(unitsInTransit)} units between locations`} icon={<ArrowLeftRight />} />
          <Stat label="Received this month" value={formatNumber(transfers.filter((t) => t.status === "received" && t.receivedAt && new Date(t.receivedAt).getMonth() === new Date().getMonth()).length)} />
          <Stat label="All transfers" value={formatNumber(transfers.length)} />
        </div>
        <TransfersTable transfers={transfers} onSelect={(t) => setSelectedId(t.id)} onNew={writable ? () => setCreating({}) : undefined} />
      </div>
      <TransferDrawer open={!!creating} onClose={() => setCreating(null)} initialItems={creating?.items} onCreated={(t) => setSelectedId(t.id)} />
      <TransferDetailModal transfer={selected} onClose={() => setSelectedId(null)} canWrite={writable} />
    </Page>
  );
}
