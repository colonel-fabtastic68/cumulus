"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { currentInstance, isDemo } from "@/lib/firebase-config";
import { hasFeature } from "@/lib/instances";
import type { IntegrationId } from "@/lib/types";
import { useCollection } from "@/lib/store/provider";
import { ranchModeOf } from "@/lib/ranch/squareTruth";
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

/** What the connections do on a ranch instance, where the bridge (src/lib/ranch) replaces the generic sync. */
const RANCH_COPY: Partial<Record<IntegrationId, string>> = {
  woocommerce: "Sells the web packs. Each pack's stock and web price go to the store product with the same SKU; paid orders come back and take their pounds from the oldest animal. Product names, photos and descriptions stay as you edit them in WooCommerce.",
  square: "Sells every cut per animal (Lot #) at the counter. Counts and counter sales stay in step with this inventory lot by lot, and web sales go back to Square. Connect by signing in with Square.",
};

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
  // A bespoke instance only offers the connections it was set up with.
  const instance = currentInstance();
  const offered = instance ? INTEGRATIONS.filter((d) => (instance.integrations as string[]).includes(d.id)).map((d) => (hasFeature(instance, "ranch") && RANCH_COPY[d.id] ? { ...d, description: RANCH_COPY[d.id]! } : d)) : INTEGRATIONS;
  const channels = offered.filter((d) => d.kind === "channel");
  const carriers = offered.filter((d) => d.kind === "carrier");
  const accounting = offered.filter((d) => d.kind === "accounting");
  const pos = offered.filter((d) => d.kind === "pos");
  const roadmap = offered.filter((d) => d.kind === "roadmap");

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
              ? "The demo runs entirely in your browser, so there is nowhere to keep store or carrier credentials. Create an account to connect Shopify, WooCommerce, QuickBooks, Square, Clover or a carrier to your own workspace. CSV import works here too."
              : "This install is in local mode, so there is no server to hold API credentials. Sign in to a hosted workspace to connect a store or carrier. CSV import works everywhere."}
          </Banner>
        )}

        {hasFeature(instance, "ranch") && (
          <Banner tone="info" title="How the two connections work together">
            {ranchModeOf(integrations.find((i) => i.id === "square")?.config) === "cumulus"
              ? "This inventory keeps the count of every cut per animal and sets Square's (its Lot # options); counter sales in Square come in here. "
              : "Square keeps the count of every cut per animal (its Lot # options); those counts come in here. "}
            WooCommerce sells the web packs: the stock and price of each pack go out to the store, and paid web orders come back to take their pounds from the oldest animal and tell Square. Card payments stay with the store&apos;s Square gateway.
          </Banner>
        )}

        {channels.length > 0 && <section>
          <SectionHeading title="Sales channels" description="Products in, orders in, stock levels out. Webhooks keep it live; a scheduled pass catches anything missed." />
          <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
            {channels.map((def) => (
              <IntegrationCard key={def.id} def={def} integration={byId.get(def.id)} onSetUp={() => setSetupId(def.id)} />
            ))}
          </div>
        </section>}

        {carriers.length > 0 && <section>
          <SectionHeading title="Shipping carriers" description="Connect one aggregator and every carrier on that account shows up when you ship an order: rates, labels and tracking." />
          <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
            {carriers.map((def) => (
              <IntegrationCard key={def.id} def={def} integration={byId.get(def.id)} onSetUp={() => setSetupId(def.id)} />
            ))}
          </div>
        </section>}

        {pos.length > 0 && <section>
          <SectionHeading title="Point of sale" description="Item libraries and in-store counts, so what sells over the counter is the same catalog as here." />
          <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
            {pos.map((def) => (
              <IntegrationCard key={def.id} def={def} integration={byId.get(def.id)} onSetUp={() => setSetupId(def.id)} />
            ))}
          </div>
        </section>}

        {accounting.length > 0 && <section>
          <SectionHeading title="Accounting" description="Products and Services in by SKU, with sales prices and purchase costs, so items here match the books." />
          <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
            {accounting.map((def) => (
              <IntegrationCard key={def.id} def={def} integration={byId.get(def.id)} onSetUp={() => setSetupId(def.id)} />
            ))}
          </div>
        </section>}

        {roadmap.length > 0 && <section>
          <SectionHeading title="On the roadmap" description="Save your details now; the CSV export works in the meantime." />
          <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
            {roadmap.map((def) => (
              <IntegrationCard key={def.id} def={def} integration={byId.get(def.id)} onSetUp={() => setSetupId(def.id)} />
            ))}
          </div>
        </section>}

        {!instance && (
          <section>
            <SectionHeading title="Available now" description="What already works today." />
            <AvailableNowCards />
          </section>
        )}
      </div>

      <IntegrationSetupModal open={!!setupDef} onClose={() => setSetupId(null)} def={setupDef} integration={setupDef ? byId.get(setupDef.id) : undefined} />
    </Page>
  );
}
