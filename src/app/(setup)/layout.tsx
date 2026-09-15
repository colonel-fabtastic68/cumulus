import type { ReactNode } from "react";
import { Providers } from "@/app/providers";
import { runtimeConfigFromEnv } from "@/lib/firebase-config";

// Standalone account screens outside the app shell (creating a workspace). Read FIREBASE_* per request.
export const dynamic = "force-dynamic";

export default function SetupLayout({ children }: { children: ReactNode }) {
  return <Providers runtimeConfig={runtimeConfigFromEnv()}>{children}</Providers>;
}
