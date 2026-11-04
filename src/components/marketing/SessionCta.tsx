"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui";
import { CONTACT_EMAIL } from "@/lib/contact";
import { setRuntimeConfig, type RuntimeConfig } from "@/lib/firebase-config";
import { getFirebaseApp, getFirebaseAuth } from "@/lib/store/firestore";
import { APP_HOME } from "@/lib/auth-routes";

type Session = "none" | "signed-out" | "signed-in";

/**
 * Calls to action that know about the visitor: local installs have no accounts,
 * a signed-in visitor gets a shortcut into the workspace, everyone else is
 * pointed at the demo booking, with sign-in for teams that already have a workspace.
 */
export function SessionCta({ runtimeConfig, placement }: { runtimeConfig: RuntimeConfig; placement: "nav" | "hero" }) {
  setRuntimeConfig(runtimeConfig);
  const accounts = runtimeConfig.firebase !== null;
  const [session, setSession] = useState<Session>(accounts ? "signed-out" : "none");

  useEffect(() => {
    if (!runtimeConfig.firebase) return;
    let unsub = () => {};
    let cancelled = false;
    (async () => {
      const { onAuthStateChanged } = await import("firebase/auth");
      if (cancelled) return;
      unsub = onAuthStateChanged(getFirebaseAuth(getFirebaseApp(runtimeConfig.firebase!)), (u) => setSession(u ? "signed-in" : "signed-out"));
    })();
    return () => {
      cancelled = true;
      unsub();
    };
  }, [runtimeConfig.firebase]);

  const size = placement === "nav" ? "md" : "lg";

  if (session !== "signed-out") {
    return (
      <Button variant="primary" size={size} href={APP_HOME} iconRight={placement === "nav" ? undefined : <ArrowRight />}>
        {session === "signed-in" ? "Open your workspace" : "Open the workspace"}
      </Button>
    );
  }

  if (placement === "nav") {
    return (
      <div className="flex items-center gap-1.5">
        <span className="hidden lg:inline-flex">
          <Button size="md" variant="tertiary" href={`mailto:${CONTACT_EMAIL}`}>
            Contact
          </Button>
        </span>
        <span className="hidden md:inline-flex">
          <Button size="md" variant="tertiary" href="/sign-in">
            Sign in
          </Button>
        </span>
        <Button size="md" variant="primary" href="/#demo">
          Book a demo
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" size="lg" href="/#demo" iconRight={<ArrowRight />}>
        Book a demo
      </Button>
      <Button size="lg" href="/product">
        See the product
      </Button>
    </div>
  );
}
