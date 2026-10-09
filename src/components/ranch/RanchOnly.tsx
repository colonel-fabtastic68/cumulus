"use client";

import type { ReactNode } from "react";
import { Beef } from "lucide-react";
import { currentInstance } from "@/lib/firebase-config";
import { hasFeature } from "@/lib/instances";
import { EmptyState, Page } from "@/components/ui";

/** Ranch pages only render on an instance with the ranch feature (the proxy also keeps them off the shared product). */
export function RanchOnly({ children }: { children: ReactNode }) {
  if (hasFeature(currentInstance(), "ranch")) return <>{children}</>;
  return (
    <Page title="Ranch">
      <EmptyState icon={<Beef />} title="Not part of this workspace" description="Web packs, animals and the Square bridge are set up for ranch workspaces only." />
    </Page>
  );
}
