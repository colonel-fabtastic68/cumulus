import { Suspense } from "react";
import type { Metadata } from "next";
import { NewWorkspace } from "@/components/workspace/new/NewWorkspace";

export const metadata: Metadata = { title: "Start a workspace · cumulusOS" };

export default function NewWorkspacePage() {
  return (
    <Suspense>
      <NewWorkspace />
    </Suspense>
  );
}
