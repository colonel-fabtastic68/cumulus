"use client";

import { Suspense, useEffect } from "react";
import { Page } from "@/components/ui";
import { WorkspaceHub } from "@/components/workspace/hub";
import { useAgent } from "@/components/agent/AgentProvider";

export default function AccountPage() {
  const { setPageContext } = useAgent();
  useEffect(() => {
    setPageContext({ page: "Account" });
  }, [setPageContext]);
  return (
    <Page title="Account" subtitle="Your sign-in details, the workspaces you belong to, and invites waiting for you">
      <Suspense>
        <WorkspaceHub />
      </Suspense>
    </Page>
  );
}
