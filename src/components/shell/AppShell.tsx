"use client";

import { useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { useAuth } from "@/lib/auth";
import { useStoreContext } from "@/lib/store/provider";
import { Button, Skeleton } from "@/components/ui";
import { CloudMark } from "./Sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const { ready } = useStoreContext();
  const { user, loading, mode, signIn } = useAuth();
  const [mobileNav, setMobileNav] = useState(false);

  if (!ready || loading) {
    return (
      <div className="flex h-screen">
        <div className="hidden w-[232px] border-r border-border p-4 md:block">
          <Skeleton className="mb-6 h-7 w-32" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="mb-2 h-7 w-full" />
          ))}
        </div>
        <div className="flex-1 p-8">
          <Skeleton className="mb-4 h-7 w-56" />
          <div className="grid grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (mode === "firestore" && !user) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg p-6">
        <div className="card w-full max-w-sm p-6 text-center">
          <span className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[10px] bg-primary text-white">
            <CloudMark className="h-5 w-5" />
          </span>
          <h1 className="text-[16px] font-semibold">Sign in to Cumulus</h1>
          <p className="mt-1 text-[13px] text-text-secondary">Use your Google account to join the workspace.</p>
          <Button variant="primary" className="mt-4" fullWidth onClick={() => signIn()}>
            Continue with Google
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <div className="hidden md:block">
        <Sidebar />
      </div>
      {mobileNav && (
        <div className="fixed inset-0 z-[80] bg-black/30 md:hidden" onClick={() => setMobileNav(false)}>
          <div className="absolute inset-y-0 left-0" onClick={(e) => e.stopPropagation()}>
            <Sidebar onNavigate={() => setMobileNav(false)} />
            <button type="button" className="absolute right-2 top-3 rounded p-1 text-text-secondary" onClick={() => setMobileNav(false)} aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileNav(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>
      <AgentPanel />
    </div>
  );
}
