"use client";

import type { ReactNode } from "react";
import { ArrowRight, FileSpreadsheet, MessageSquarePlus, Sparkles } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { useAgent } from "@/components/agent/AgentProvider";

const REQUEST_PROMPT = `Integration request from the Integrations page.

Platform: (which system do you want connected?)
What should sync: (products, stock levels, orders, costs...)
Why it matters: (what you do by hand today)

Please acknowledge the request and summarise it back so it is on record in this conversation.`;

function FeatureCard({ icon, title, badge, description, action }: { icon: ReactNode; title: string; badge?: ReactNode; description: string; action: ReactNode }) {
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-surface-hover text-text-secondary [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13.5px] font-semibold text-text">{title}</h3>
            {badge}
          </div>
          <p className="mt-1 text-[12.5px] leading-[1.45] text-text-secondary">{description}</p>
        </div>
      </div>
      <div className="mt-auto pt-1">{action}</div>
    </div>
  );
}

export function AvailableNowCards() {
  const { open } = useAgent();
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <FeatureCard
        icon={<FileSpreadsheet />}
        title="CSV import"
        badge={<Badge tone="success">Available now</Badge>}
        description="Upload a spreadsheet or a Shopify, WooCommerce, QuickBooks or Square export. Columns are mapped with AI help, previewed, then upserted by SKU."
        action={
          <Button size="sm" href="/import" iconRight={<ArrowRight />}>
            Import a CSV
          </Button>
        }
      />
      <FeatureCard
        icon={<Sparkles />}
        title="Agent access"
        badge={<Badge tone="success">Available now</Badge>}
        description="The agent already reads and changes everything through the app: bulk price updates, receiving, builds, orders and returns, each as a proposal you approve."
        action={
          <Button size="sm" href="/agents" iconRight={<ArrowRight />}>
            Open Agents
          </Button>
        }
      />
      <FeatureCard
        icon={<MessageSquarePlus />}
        title="Request an integration"
        description="Missing a system you rely on? Tell the agent what you would want to sync. The request stays inside this workspace; nothing is sent externally."
        action={
          <Button size="sm" icon={<Sparkles />} onClick={() => open(REQUEST_PROMPT, { send: false })}>
            Draft a request
          </Button>
        }
      />
    </div>
  );
}
