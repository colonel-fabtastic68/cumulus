import type { ReactNode } from "react";
import { Providers } from "@/app/providers";
import { requestRuntimeConfig } from "@/lib/server/runtime";

// Standalone account screens outside the app shell (creating a workspace). Read FIREBASE_* per request.
// src/proxy.ts keeps these off bespoke instances; the instance-aware config is belt and braces.
export const dynamic = "force-dynamic";

export default async function SetupLayout({ children }: { children: ReactNode }) {
  return <Providers runtimeConfig={await requestRuntimeConfig()}>{children}</Providers>;
}
