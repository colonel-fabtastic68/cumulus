import type { Metadata } from "next";
import { FinalCta, Features, Hero, Integrations, MailingList, StratoSection, PilotSteps, Pricing } from "@/components/marketing/sections";
import { runtimeConfigFromEnv } from "@/lib/firebase-config";

export const metadata: Metadata = {
  title: "cumulusOS · Inventory that keeps up with your team",
  description: "Parts, BOMs, receiving and returns in one live workspace, with Strato, an agent that drafts the bulk changes and waits for your approval.",
};

export default function LandingPage() {
  const runtimeConfig = runtimeConfigFromEnv();
  return (
    <>
      <Hero runtimeConfig={runtimeConfig} />
      <Features />
      <StratoSection />
      <Integrations />
      <PilotSteps />
      <Pricing runtimeConfig={runtimeConfig} />
      <MailingList />
      <FinalCta runtimeConfig={runtimeConfig} />
    </>
  );
}
