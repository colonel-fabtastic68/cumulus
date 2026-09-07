"use client";

import { Suspense, useEffect } from "react";
import { Page } from "@/components/ui";
import { WorkspaceHub } from "@/components/workspace/hub";
import { useAgent } from "@/components/agent/AgentProvider";

export default function WorkspacesPage() {
  const { setPageContext } = useAgent();
  useEffect(() => {
    setPageContext({ page: "Workspaces" });
  }, [setPageContext]);
  return (
    <Page title="Workspaces" subtitle="Switch between the companies you belong to, create another one, or redeem an invite">
      <Suspense>
        <WorkspaceHub />
      </Suspense>
    </Page>
  );
}
