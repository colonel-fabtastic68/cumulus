import type { ReactNode } from "react";
import { Providers } from "@/app/providers";
import { AppShell } from "@/components/shell/AppShell";
import { runtimeConfigFromEnv } from "@/lib/firebase-config";

// Render per request so FIREBASE_* / CUMULUS_WORKSPACE are read from the live
// environment, not frozen into the build (and its cache) at deploy time.
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Providers runtimeConfig={runtimeConfigFromEnv()}>
      <AppShell>{children}</AppShell>
    </Providers>
  );
}
