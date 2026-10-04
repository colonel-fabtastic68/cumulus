import type { Metadata } from "next";
import { Features, Hero, Integrations, PilotSteps, StratoSection, Waitlist } from "@/components/marketing/sections";
import { runtimeConfigFromEnv } from "@/lib/firebase-config";

export const metadata: Metadata = {
  title: "cumulusOS · Inventory that keeps up with your team",
  description: "Parts, BOMs, receiving and returns in one live workspace, with Strato, an agent that drafts the bulk changes and waits for your approval. Join the waitlist for a workspace built around your stock.",
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
      <Waitlist />
    </>
  );
}
