"use client";

import { useEffect, useMemo, useState } from "react";
import type { IntegrationId } from "@/lib/types";
import { useCollection } from "@/lib/store/provider";
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
  const { setPageContext } = useAgent();
  const [setupId, setSetupId] = useState<IntegrationId | null>(null);

  useEffect(() => {
    setPageContext({ page: "Integrations" });
  }, [setPageContext]);

  const byId = useMemo(() => new Map(integrations.map((i) => [i.id, i])), [integrations]);
  const setupDef = integrationDef(setupId);

  return (
    <Page title="Integrations" subtitle="Connect the places your inventory already lives">
      <div className="flex flex-col gap-4">
        <Banner tone="info" title="Live sync is not built yet">
          The cards below describe what each connection will do once it ships. Until then, every one of these platforms exports a CSV that imports here in under a minute, and Nimbus can do the rest.
        </Banner>

        <section>
          <SectionHeading title="Storefronts and accounting" description="Save your store details now so the connection is ready to switch on later." />
          <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
            {INTEGRATIONS.map((def) => (
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
