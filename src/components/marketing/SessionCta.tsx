"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui";
import { setRuntimeConfig, type RuntimeConfig } from "@/lib/firebase-config";
import { getFirebaseApp } from "@/lib/store/firestore";
import { APP_HOME } from "@/lib/auth-routes";

type Session = "none" | "signed-out" | "signed-in";

/**
 * Calls to action that know about the visitor: local installs have no accounts,
 * a signed-in visitor gets a shortcut into the workspace, everyone else sees
 * sign in / start free.
 */
export function SessionCta({ runtimeConfig, placement }: { runtimeConfig: RuntimeConfig; placement: "nav" | "hero" | "band" }) {
  setRuntimeConfig(runtimeConfig);
  const accounts = runtimeConfig.firebase !== null;
  const [session, setSession] = useState<Session>(accounts ? "signed-out" : "none");

  useEffect(() => {
    if (!runtimeConfig.firebase) return;
    let unsub = () => {};
    let cancelled = false;
    (async () => {
      const { getAuth, onAuthStateChanged } = await import("firebase/auth");
      if (cancelled) return;
      unsub = onAuthStateChanged(getAuth(getFirebaseApp(runtimeConfig.firebase!)), (u) => setSession(u ? "signed-in" : "signed-out"));
    })();
    return () => {
      cancelled = true;
      unsub();
    };
  }, [runtimeConfig.firebase]);

  const size = placement === "nav" ? "md" : "lg";

  if (session !== "signed-out") {
    const label = session === "signed-in" ? "Open your workspace" : "Open the workspace";
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size={size} href={APP_HOME} iconRight={placement === "nav" ? undefined : <ArrowRight />}>
          {label}
        </Button>
        {placement === "hero" && (
          <Button size={size} href="#nimbus">
            See how Nimbus works
          </Button>
        )}
      </div>
    );
  }

  if (placement === "nav") {
    return (
      <div className="flex items-center gap-2">
        <Button size="md" variant="tertiary" href="/sign-in">
          Sign in
        </Button>
        <Button size="md" variant="primary" href="/sign-up">
          Start free
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" size="lg" href="/sign-up" iconRight={<ArrowRight />}>
        Start free
      </Button>
      <Button size="lg" href={placement === "hero" ? "#nimbus" : "/sign-in"}>
        {placement === "hero" ? "See how Nimbus works" : "Sign in"}
      </Button>
    </div>
  );
}
