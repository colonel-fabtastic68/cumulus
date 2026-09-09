"use client";

import { useEffect, useMemo, useState } from "react";
import type { IntegrationId } from "@/lib/types";
import { useCollection } from "@/lib/store/provider";
import { useSession } from "@/lib/session";
import { useAgent } from "@/components/agent/AgentProvider";
import { Banner, Page } from "@/components/ui";
import { AvailableNowCards, INTEGRATIONS, IntegrationCard, IntegrationSetupModal, integrationDef } from "@/components/workspace/integrations";

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-2.5">
      <h2 className="text-[14px] font-semibold text-text">{title}</h2>
      {description && <p className="mt-0.5 text-[12.5px] text-text-secondary">{description}</p>}
    </div>
  );
}

export default function IntegrationsPage() {
  const integrations = useCollection("integrations");
  const { mode } = useSession();
  const { setPageContext } = useAgent();
  const [setupId, setSetupId] = useState<IntegrationId | null>(null);

  useEffect(() => {
    setPageContext({ page: "Integrations" });
  }, [setPageContext]);

  const byId = useMemo(() => new Map(integrations.map((i) => [i.id, i])), [integrations]);
  const setupDef = integrationDef(setupId);
  const channels = INTEGRATIONS.filter((d) => d.kind === "channel");
  const carriers = INTEGRATIONS.filter((d) => d.kind === "carrier");
  const roadmap = INTEGRATIONS.filter((d) => d.kind === "roadmap");

  return (
    <Page title="Integrations" subtitle="Connect the places your inventory already lives">
      <div className="flex flex-col gap-5">
        {mode !== "firestore" && (
          <Banner tone="info" title="Live connections run in the hosted version">
            This install is in local mode, so there is no server to hold API credentials. Sign in to a hosted workspace to connect a store or carrier. CSV import works everywhere.
          </Banner>
        )}

        <section>
          <SectionHeading title="Sales channels" description="Products in, orders in, stock levels out. Webhooks keep it live; a scheduled pass catches anything missed." />
          <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
            {channels.map((def) => (
              <IntegrationCard key={def.id} def={def} integration={byId.get(def.id)} onSetUp={() => setSetupId(def.id)} />
            ))}
          </div>
        </section>

        <section>
          <SectionHeading title="Shipping carriers" description="Connect one aggregator and every carrier on that account shows up when you ship an order: rates, labels and tracking." />
          <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
            {carriers.map((def) => (
              <IntegrationCard key={def.id} def={def} integration={byId.get(def.id)} onSetUp={() => setSetupId(def.id)} />
            ))}
          </div>
        </section>

        <section>
          <SectionHeading title="On the roadmap" description="Save your details now; the CSV export works in the meantime." />
          <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
            {roadmap.map((def) => (
              <IntegrationCard key={def.id} def={def} integration={byId.get(def.id)} onSetUp={() => setSetupId(def.id)} />
            ))}
          </div>
        </section>

        <section>
          <SectionHeading title="Available now" description="What already works today." />
          <AvailableNowCards />
        </section>
      </div>

      <IntegrationSetupModal open={!!setupDef} onClose={() => setSetupId(null)} def={setupDef} integration={setupDef ? byId.get(setupDef.id) : undefined} />
    </Page>
  );
}
