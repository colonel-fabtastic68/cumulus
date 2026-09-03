"use client";

import type { ReactNode } from "react";
import { setRuntimeConfig, type RuntimeConfig } from "@/lib/firebase-config";
import { StoreProvider } from "@/lib/store/provider";
import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/components/ui";
import { AgentProvider } from "@/components/agent/AgentProvider";

export function Providers({ children, runtimeConfig }: { children: ReactNode; runtimeConfig?: RuntimeConfig }) {
  // Must run before StoreProvider's useState initializer creates the store.
  if (runtimeConfig) setRuntimeConfig(runtimeConfig);
  return (
    <StoreProvider>
      <AuthProvider>
        <ToastProvider>
          <AgentProvider>{children}</AgentProvider>
        </ToastProvider>
      </AuthProvider>
    </StoreProvider>
  );
}
