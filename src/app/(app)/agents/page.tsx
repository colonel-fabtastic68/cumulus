"use client";

import { useEffect, type ReactNode } from "react";
import { Page } from "@/components/ui";
import { useAgent } from "@/components/agent/AgentProvider";
import { AgentStatusCard, AutomationsCard, ConversationsTable, DataHealthCard } from "@/components/agents";

function SectionHeading({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="mb-2.5">
      <h2 className="text-[14px] font-semibold text-text">{title}</h2>
      {description && <p className="mt-0.5 text-[12.5px] text-text-secondary">{description}</p>}
    </div>
  );
}

export default function AgentsPage() {
  const { setPageContext } = useAgent();

  useEffect(() => {
    setPageContext({ page: "Agents" });
  }, [setPageContext]);

  return (
    <Page title="Agents" subtitle="Delegate bulk work. The agent reads everything, proposes changes, and applies them after you approve.">
      <div className="flex flex-col gap-4">
        <AgentStatusCard />

        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
          <DataHealthCard />
          <AutomationsCard />
        </div>

        <section>
          <SectionHeading title="Conversations" description="Everything the agent has been asked in this workspace. Open one to pick up where it left off." />
          <ConversationsTable />
        </section>
      </div>
    </Page>
  );
}
