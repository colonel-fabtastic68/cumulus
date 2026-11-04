import type { Metadata } from "next";
import { Comparison } from "@/components/marketing/Comparison";
import { CustomerLogos } from "@/components/marketing/CustomerLogos";
import { DemoSection } from "@/components/marketing/DemoSection";
import { AutomotiveSection, Hero, MotorsportSection, OtherIndustries, Steps } from "@/components/marketing/sections";
import { runtimeConfigFromEnv } from "@/lib/firebase-config";

export const metadata: Metadata = {
  title: "cumulusOS · Inventory for motorsport and aftermarket manufacturers",
  description: "Parts, BOMs, builds, receiving and orders for chassis shops, race teams and aftermarket automotive brands, with Strato drafting the bulk work for your approval. Book a demo on your own parts.",
};

export default function LandingPage() {
  const runtimeConfig = runtimeConfigFromEnv();
  return (
    <>
      <Hero runtimeConfig={runtimeConfig} />
      <CustomerLogos />
      <MotorsportSection />
      <AutomotiveSection />
      <Comparison />
      <Steps />
      <OtherIndustries />
      <DemoSection calendlyUrl={runtimeConfig.calendlyUrl} />
    </>
  );
}
