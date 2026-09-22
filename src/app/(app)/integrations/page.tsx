"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { isDemo } from "@/lib/firebase-config";
import type { IntegrationId } from "@/lib/types";
import { useCollection } from "@/lib/store/provider";
import { useSession } from "@/lib/session";
import { useAgent } from "@/components/agent/AgentProvider";
import { Banner, Page, QueryParamEffect, useToast } from "@/components/ui";
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
  const toast = useToast();
  const [setupId, setSetupId] = useState<IntegrationId | null>(null);

  // Landing back from a platform's consent screen (?connected=quickbooks or ?error=…).
  const onConnected = useCallback(
    (id: string) => {
      const def = integrationDef(id);
      if (!def) return;
      toast(`${def.name} connected`, "success");
      setSetupId(def.id);
    },
    [toast],
  );
  const onError = useCallback((message: string) => toast(message, "critical"), [toast]);

  useEffect(() => {
    setPageContext({ page: "Integrations" });
  }, [setPageContext]);

  const byId = useMemo(() => new Map(integrations.map((i) => [i.id, i])), [integrations]);
  const setupDef = integrationDef(setupId);
  const channels = INTEGRATIONS.filter((d) => d.kind === "channel");
  const carriers = INTEGRATIONS.filter((d) => d.kind === "carrier");
  const accounting = INTEGRATIONS.filter((d) => d.kind === "accounting");
  const pos = INTEGRATIONS.filter((d) => d.kind === "pos");
  const roadmap = INTEGRATIONS.filter((d) => d.kind === "roadmap");

  return (
    <Page title="Integrations" subtitle="Connect the places your inventory already lives">
      <Suspense>
        <QueryParamEffect param="connected" onValue={onConnected} />
        <QueryParamEffect param="error" onValue={onError} />
      </Suspense>
      <div className="flex flex-col gap-5">
        {mode !== "firestore" && (
          <Banner tone="info" title={isDemo() ? "Connections need an account" : "Live connections run in the hosted version"}>
            {isDemo()
              ? "The demo runs entirely in your browser, so there is nowhere to keep store or carrier credentials. Create an account to connect Shopify, WooCommerce, QuickBooks, Square or a carrier to your own workspace. CSV import works here too."
              : "This install is in local mode, so there is no server to hold API credentials. Sign in to a hosted workspace to connect a store or carrier. CSV import works everywhere."}
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
          <SectionHeading title="Point of sale" description="Item libraries and in-store counts, so what sells over the counter is the same catalog as here." />
          <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
            {pos.map((def) => (
              <IntegrationCard key={def.id} def={def} integration={byId.get(def.id)} onSetUp={() => setSetupId(def.id)} />
            ))}
          </div>
        </section>

        <section>
          <SectionHeading title="Accounting" description="Products and Services in by SKU, with sales prices and purchase costs, so items here match the books." />
          <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
            {accounting.map((def) => (
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
