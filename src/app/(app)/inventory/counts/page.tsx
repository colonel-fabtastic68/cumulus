"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Sparkles } from "lucide-react";
import { useCollection } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { Button, Page } from "@/components/ui";
import { CountsTable, NewCountModal } from "@/components/counts";

export default function CycleCountsPage() {
  const counts = useCollection("cycleCounts");
  const user = useCurrentUser();
  const writable = canWrite(user);
  const router = useRouter();
  const { open: openAgent, setPageContext } = useAgent();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setPageContext({ page: "Cycle counts" });
  }, [setPageContext]);

  return (
    <Page
      title="Cycle counts"
      subtitle="Count a few bins at a time and keep the ledger honest"
      primaryAction={
        writable ? (
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
            New count
          </Button>
        ) : undefined
      }
      secondaryActions={
        <Button icon={<Sparkles />} onClick={() => openAgent("Propose a cycle count: which bins or items should we count first and why, with the quantity you expect on the shelf for each.")}>
          Ask Strato
        </Button>
      }
    >
      <CountsTable counts={counts} onOpen={(c) => router.push(`/inventory/counts/${c.id}`)} onNew={writable ? () => setCreating(true) : undefined} />
      <NewCountModal open={creating} onClose={() => setCreating(false)} onStarted={(c) => router.push(`/inventory/counts/${c.id}`)} />
    </Page>
  );
}
