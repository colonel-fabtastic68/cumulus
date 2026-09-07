import type { ReactNode } from "react";
import { MarketingFooter, MarketingNav } from "@/components/marketing/chrome";
import { runtimeConfigFromEnv } from "@/lib/firebase-config";

// Read FIREBASE_* at request time so the calls to action know whether this install has accounts.
export const dynamic = "force-dynamic";

export default function MarketingLayout({ children }: { children: ReactNode }) {
  const runtimeConfig = runtimeConfigFromEnv();
  return (
    <div className="landing flex min-h-[100dvh] flex-col bg-bg text-text">
      <MarketingNav runtimeConfig={runtimeConfig} />
      <main className="flex-1">{children}</main>
      <MarketingFooter />
    </div>
  );
}
