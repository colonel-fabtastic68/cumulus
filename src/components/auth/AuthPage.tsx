"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Skeleton } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { APP_HOME, safeNext } from "@/lib/auth-routes";

const noop = () => () => {};
/** False during server rendering and hydration, true once the component has mounted in the browser. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

/** The destination after signing in, taken from ?next= when it is a safe in-app path. */
export function useNextPath(): string {
  const params = useSearchParams();
  return safeNext(params.get("next"));
}

/**
 * Card chrome shared by sign-in, sign-up and reset. Handles the states that are
 * not a form: local mode has no accounts, a signed-in visitor goes straight to
 * the workspace, and auth state is still resolving.
 */
export function AuthPage({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const { mode, loading, signedIn } = useAuth();
  const router = useRouter();
  const next = useNextPath();
  // The server has no Firebase session and no browser store, so its idea of `mode` and `loading`
  // can differ from the client's. Render the same skeleton on both sides until hydration is done.
  const hydrated = useHydrated();
  const redirect = hydrated && mode === "firestore" && !loading && signedIn;

  useEffect(() => {
    if (redirect) router.replace(next);
  }, [redirect, next, router]);

  if (hydrated && mode === "local") {
    return (
      <AuthCard title="No sign-in needed here" subtitle="This Cumulus runs in local mode, so there are no accounts. Everything is stored in this browser.">
        <Button variant="primary" size="lg" fullWidth href={APP_HOME}>
          Open the workspace
        </Button>
      </AuthCard>
    );
  }

  if (!hydrated || loading || redirect) {
    return (
      <AuthCard title={redirect ? "Taking you to your workspace" : title}>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={title} subtitle={subtitle} footer={footer}>
      {children}
    </AuthCard>
  );
}

function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <>
      <section className="card p-6 sm:p-8">
        <h1 className="text-[20px] font-semibold leading-7 text-text">{title}</h1>
        {subtitle && <p className="mt-1.5 text-[13.5px] leading-5 text-text-secondary">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </section>
      {footer && <p className="mt-5 text-center text-[13px] text-text-secondary">{footer}</p>}
    </>
  );
}
