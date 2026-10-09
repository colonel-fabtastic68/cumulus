import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { Providers } from "@/app/providers";
import { AppShell } from "@/components/shell/AppShell";
import { requestRuntimeConfig } from "@/lib/server/runtime";
import { DEMO_COOKIE, demoRuntimeConfig } from "@/lib/demo";

// Render per request so FIREBASE_* / CUMULUS_WORKSPACE are read from the live
// environment, not frozen into the build (and its cache) at deploy time.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const base = await requestRuntimeConfig();
  // The public demo runs the sample workspace in the browser, whatever the server is configured with.
  // A bespoke instance never does: it only ever shows its own workspace.
  const demo = !base.instance && (await cookies()).get(DEMO_COOKIE)?.value === "1";
  return (
    <Providers runtimeConfig={demo ? demoRuntimeConfig(base) : base}>
      <AppShell>{children}</AppShell>
    </Providers>
  );
}
