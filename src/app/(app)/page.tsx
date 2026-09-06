"use client";

import { useEffect, useState } from "react";
import { PackageCheck, Plus, Sparkles } from "lucide-react";
import { Button, Page, PageLayout } from "@/components/ui";
import { ItemFormModal } from "@/components/inventory";
import { useAgent } from "@/components/agent/AgentProvider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import {
  DashboardEmpty,
  KpiRow,
  NeedsAttentionCard,
  OpenReturnsCard,
  RecentActivityCard,
  ShippedVsBuiltChart,
  TeamCard,
  ToShipCard,
  greetingFor,
  todayLabel,
  useDashboardData,
} from "@/components/dashboard";

export default function HomePage() {
  const user = useCurrentUser();
  const writable = canWrite(user);
  const { open: openAgent, setPageContext } = useAgent();
  const data = useDashboardData();
  const [newItemOpen, setNewItemOpen] = useState(false);

  useEffect(() => {
    setPageContext({ page: "Home dashboard" });
  }, [setPageContext]);

  const empty = data.items.length === 0;

  return (
    <Page
      title={greetingFor(user.name)}
      subtitle={`${data.settings.companyName} · ${todayLabel()}`}
      wide
      primaryAction={
        <Button variant="primary" icon={<Sparkles />} onClick={() => openAgent()}>
          Ask the agent
        </Button>
      }
      secondaryActions={
        writable ? (
          <>
            <Button icon={<Plus />} onClick={() => setNewItemOpen(true)}>
              New item
            </Button>
            <Button icon={<PackageCheck />} href="/receiving?new=1">
              Receive stock
            </Button>
          </>
        ) : undefined
      }
    >
      {empty ? (
        <DashboardEmpty onNewItem={() => setNewItemOpen(true)} canCreate={writable} />
      ) : (
        <>
          <KpiRow
            value={data.value}
            currency={data.currency}
            activeCount={data.activeCount}
            assemblyCount={data.assemblyCount}
            lowCount={data.lowRows.length}
            openOrders={data.openOrders}
            openRmas={data.openRmas}
            shipped={data.shipped}
          />
          <PageLayout
            aside={
              <>
                <RecentActivityCard events={data.recentActivity} membersById={data.membersById} />
                <TeamCard members={data.members} />
              </>
            }
          >
            <NeedsAttentionCard rows={data.lowRows} />
            <ToShipCard orders={data.openOrders} itemsById={data.itemsById} />
            <OpenReturnsCard rmas={data.openRmas} itemsById={data.itemsById} />
            <ShippedVsBuiltChart weeks={data.weeks} />
          </PageLayout>
        </>
      )}
      <ItemFormModal open={newItemOpen} onClose={() => setNewItemOpen(false)} />
    </Page>
  );
}
