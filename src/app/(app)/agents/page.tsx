"use client";

import { useEffect, type ReactNode } from "react";
import { Page } from "@/components/ui";
import { useAgent } from "@/components/agent/AgentProvider";
import { AutomationsCard, ConversationsTable, DataHealthCard, McpCard } from "@/components/agents";

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
    setPageContext({ page: "Nimbus" });
  }, [setPageContext]);

  return (
    <Page title="Nimbus" subtitle="Delegate bulk work. Nimbus reads everything, proposes changes, and applies them after you approve.">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
          <DataHealthCard />
          <AutomationsCard />
        </div>

        <section>
          <SectionHeading title="Connect other agents" description="Let other AI agents and tools reach this workspace through the Model Context Protocol, with the same tools Nimbus has." />
          <McpCard />
        </section>

        <section>
          <SectionHeading title="Conversations" description="Everything Nimbus has been asked in this workspace. Open one to pick up where it left off." />
          <ConversationsTable />
        </section>
      </div>
    </Page>
  );
}
