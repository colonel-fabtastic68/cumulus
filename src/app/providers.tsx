"use client";

import type { ReactNode } from "react";
import { setRuntimeConfig, type RuntimeConfig } from "@/lib/firebase-config";
import { SessionProvider, useSession } from "@/lib/session";
import { StoreProvider } from "@/lib/store/provider";
import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/components/ui";
import { AgentProvider } from "@/components/agent/AgentProvider";
import { GuideProvider } from "@/components/guide/GuideProvider";
import { PresenceProvider } from "@/components/presence/PresenceProvider";

export function Providers({ children, runtimeConfig }: { children: ReactNode; runtimeConfig?: RuntimeConfig }) {
  // Must run before anything below reads the Firebase config.
  if (runtimeConfig) setRuntimeConfig(runtimeConfig);
  return (
    <SessionProvider>
      <WorkspaceTree>{children}</WorkspaceTree>
    </SessionProvider>
  );
}

/** The store, and everything that reads it, is rebuilt when the open workspace changes. */
function WorkspaceTree({ children }: { children: ReactNode }) {
  const { mode, workspaceId } = useSession();
  const key = mode === "local" ? "local" : (workspaceId ?? "none");
  return (
    <StoreProvider key={key} workspaceId={mode === "local" ? null : workspaceId}>
      <AuthProvider>
        <PresenceProvider>
          <ToastProvider>
            <AgentProvider>
              <GuideProvider>{children}</GuideProvider>
            </AgentProvider>
          </ToastProvider>
        </PresenceProvider>
      </AuthProvider>
    </StoreProvider>
  );
}
