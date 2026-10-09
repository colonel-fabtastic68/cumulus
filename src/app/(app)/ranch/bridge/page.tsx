"use client";

import { useEffect } from "react";
import { useAgent } from "@/components/agent/AgentProvider";
import { BridgeView, RanchOnly } from "@/components/ranch";

export default function RanchBridgeViewPage() {
  const { setPageContext } = useAgent();
  useEffect(() => {
    setPageContext({ page: "Square & store" });
  }, [setPageContext]);
  return (
    <RanchOnly>
      <BridgeView />
    </RanchOnly>
  );
}
