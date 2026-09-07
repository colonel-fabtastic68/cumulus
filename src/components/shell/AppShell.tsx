"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { useAuth } from "@/lib/auth";
import { useSettings, useStoreContext } from "@/lib/store/provider";
import { Onboarding } from "./Onboarding";
import { PreviewBar } from "./PreviewBar";
import { Banner, Button, Skeleton } from "@/components/ui";
import { signInHref } from "@/lib/auth-routes";
import { useNavArrowKeys } from "./useNavArrowKeys";

function LoadingSkeleton({ note }: { note?: ReactNode }) {
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
        {note && <div className="mt-6 max-w-xl">{note}</div>}
      </div>
    </div>
  );
}

function CenterCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen items-center justify-center bg-bg p-6">
      <div className="card w-full max-w-md p-6">{children}</div>
    </div>
  );
}

const FIRESTORE_HINTS = (
  <ul className="mt-2 list-disc pl-4 text-[12.5px] text-text-secondary">
    <li>Cloud Firestore is created for the project (Firebase console → Build → Firestore Database).</li>
    <li>Rules allow signed-in users: deploy <code>firestore.rules</code> from this repo.</li>
    <li>
      <code>FIREBASE_PROJECT_ID</code> matches the project. Remove the <code>FIREBASE_*</code> lines from <code>.env.local</code> to go back to local mode.
    </li>
  </ul>
);

export function AppShell({ children }: { children: ReactNode }) {
  const { ready, error: storeError } = useStoreContext();
  const { user, signedIn, loading, mode } = useAuth();
  const settings = useSettings();
  const [mobileNav, setMobileNav] = useState(false);
  const [slow, setSlow] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  // Shift+↑/↓ walk the sidebar once the workspace is open (not on sign-in, loading or onboarding screens).
  useNavArrowKeys(ready && !!user && !!settings.companyName.trim());

  // Firestore mode: accounts live on their own pages. Send signed-out visitors there and bring them back afterwards.
  const needsSignIn = mode === "firestore" && !loading && !signedIn;
  useEffect(() => {
    if (needsSignIn) router.replace(signInHref(pathname));
  }, [needsSignIn, pathname, router]);

  // Flag a slow Firestore connection so the skeleton never looks frozen.
  useEffect(() => {
    if (mode !== "firestore" || ready || !signedIn) return;
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, [mode, ready, signedIn]);

  if (loading) return <LoadingSkeleton />;

  if (mode === "firestore" && !signedIn) return <LoadingSkeleton />;

  if (storeError) {
    return (
      <CenterCard>
        <h1 className="text-[16px] font-semibold">Couldn&apos;t open the workspace</h1>
        <Banner tone="critical" className="mt-3">
          {storeError}
        </Banner>
        <p className="mt-3 text-[13px] text-text-secondary">Check that:</p>
        {FIRESTORE_HINTS}
        <Button className="mt-4" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </CenterCard>
    );
  }

  if (!ready || !user) {
    return (
      <LoadingSkeleton
        note={
          slow ? (
            <Banner tone="info" title="Still connecting to Firestore…">
              This is taking longer than usual. It usually means the database is not reachable. Check that:
              {FIRESTORE_HINTS}
            </Banner>
          ) : undefined
        }
      />
    );
  }

  // A fresh workspace (no company name yet) asks for its basics first.
  if (!settings.companyName.trim()) return <Onboarding />;

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
        <main className="@container min-h-0 flex-1 overflow-y-auto">
          <PreviewBar />
          {children}
        </main>
      </div>
      <AgentPanel />
    </div>
  );
}
