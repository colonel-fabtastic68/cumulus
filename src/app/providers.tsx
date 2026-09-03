"use client";

import type { ReactNode } from "react";
import { StoreProvider } from "@/lib/store/provider";
import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/components/ui";
import { AgentProvider } from "@/components/agent/AgentProvider";

export function Providers({ children }: { children: ReactNode }) {
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
