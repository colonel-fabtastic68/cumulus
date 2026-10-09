"use client";

import { useEffect } from "react";
import { useAgent } from "@/components/agent/AgentProvider";
import { AnimalsView, RanchOnly } from "@/components/ranch";

export default function RanchAnimalsViewPage() {
  const { setPageContext } = useAgent();
  useEffect(() => {
    setPageContext({ page: "Animals" });
  }, [setPageContext]);
  return (
    <RanchOnly>
      <AnimalsView />
    </RanchOnly>
  );
}
