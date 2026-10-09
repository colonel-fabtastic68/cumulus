"use client";

import { useEffect } from "react";
import { useAgent } from "@/components/agent/AgentProvider";
import { PacksView, RanchOnly } from "@/components/ranch";

export default function RanchPacksViewPage() {
  const { setPageContext } = useAgent();
  useEffect(() => {
    setPageContext({ page: "Web packs" });
  }, [setPageContext]);
  return (
    <RanchOnly>
      <PacksView />
    </RanchOnly>
  );
}
