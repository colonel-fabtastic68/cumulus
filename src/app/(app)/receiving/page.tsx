"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { PackageCheck, Sparkles } from "lucide-react";
import type { Receipt } from "@/lib/types";
import { useCollection } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { Button, Card, EmptyState, Page, QueryParamEffect } from "@/components/ui";
import { ReceiptDetailModal, ReceiptsTable, ReceiveDrawer, ReceivingStats, useReceiptLookups } from "@/components/receiving";

export default function ReceivingPage() {
  const receipts = useCollection("receipts");
  const lookups = useReceiptLookups();
  const user = useCurrentUser();
  const writable = canWrite(user);
  const { open: openAgent, setPageContext } = useAgent();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo<Receipt | null>(() => (selectedId ? (receipts.find((r) => r.id === selectedId) ?? null) : null), [receipts, selectedId]);

  useEffect(() => {
    setPageContext({ page: "Receiving" });
  }, [setPageContext]);

  // "?new=1" opens the receive form; "?highlight=<receiptId>" opens that receipt (links from item history).
  const openNew = useCallback(() => {
    if (writable) setDrawerOpen(true);
  }, [writable]);

  const receiveButton = (
    <Button variant="primary" icon={<PackageCheck />} onClick={() => setDrawerOpen(true)}>
      Receive stock
    </Button>
  );

  return (
    <Page
      title="Receiving"
      subtitle="Record goods in before they hit the shelf"
      primaryAction={writable ? receiveButton : undefined}
      secondaryActions={
        <Button icon={<Sparkles />} onClick={() => openAgent("Help me record a receipt")}>
          Ask Nimbus
        </Button>
      }
    >
      <Suspense fallback={null}>
        <QueryParamEffect param="new" onValue={openNew} />
        <QueryParamEffect param="highlight" onValue={setSelectedId} />
      </Suspense>
      <div className="flex flex-col gap-4">
        <ReceivingStats receipts={receipts} />
        {receipts.length === 0 ? (
          <Card padded={false}>
            <EmptyState
              icon={<PackageCheck />}
              title="No receipts yet"
              description={
                writable
                  ? "Record your first delivery to put stock on the shelf and start a cost history for every part."
                  : "Deliveries recorded by your team will show up here."
              }
              action={writable ? receiveButton : undefined}
            />
          </Card>
        ) : (
          <ReceiptsTable receipts={receipts} lookups={lookups} onOpen={(r) => setSelectedId(r.id)} />
        )}
      </div>
      <ReceiveDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <ReceiptDetailModal receipt={selected} lookups={lookups} onClose={() => setSelectedId(null)} />
    </Page>
  );
}
