"use client";

import { useEffect, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Button, Page } from "@/components/ui";
import { useAgent } from "@/components/agent/AgentProvider";
import { AgentStatusCard, AutomationsCard, ConversationsTable, DataHealthCard, QuickTasksGrid } from "@/components/agents";

function SectionHeading({ title, description }: { title: ReactNode; description?: ReactNode }) {
  return (
    <div className="mb-2.5">
      <h2 className="text-[14px] font-semibold text-text">{title}</h2>
      {description && <p className="mt-0.5 text-[12.5px] text-text-secondary">{description}</p>}
    </div>
  );
}

export default function AgentsPage() {
  const { open, setPageContext } = useAgent();

  useEffect(() => {
    setPageContext({ page: "Agents" });
  }, [setPageContext]);

  return (
    <Page
      title="Agents"
      subtitle="Delegate bulk work. The agent reads everything, proposes changes, and applies them after you approve."
      primaryAction={
        <Button variant="primary" icon={<Sparkles />} onClick={() => open()}>
          Open agent
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        <AgentStatusCard />

        <section>
          <SectionHeading title="Quick tasks" description="One click sends a precise, ready-to-run request to the agent." />
          <QuickTasksGrid />
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
