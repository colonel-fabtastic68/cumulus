import type { Metadata } from "next";
import { FinalCta, Features, Hero, Integrations, NimbusSection, PilotSteps } from "@/components/marketing/sections";
import { runtimeConfigFromEnv } from "@/lib/firebase-config";

export const metadata: Metadata = {
  title: "Cumulus · Inventory that keeps up with your team",
  description: "Parts, BOMs, receiving and returns in one live workspace, with Nimbus, an agent that drafts the bulk changes and waits for your approval.",
};

export default function LandingPage() {
  const runtimeConfig = runtimeConfigFromEnv();
  return (
    <>
      <Hero runtimeConfig={runtimeConfig} />
      <Features />
      <NimbusSection />
      <Integrations />
      <PilotSteps />
      <FinalCta runtimeConfig={runtimeConfig} />
    </>
  );
}
