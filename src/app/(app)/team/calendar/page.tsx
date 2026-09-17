"use client";

import { useEffect } from "react";
import { useAgent } from "@/components/agent/AgentProvider";
import { Page } from "@/components/ui";
import { TeamCalendar } from "@/components/calendar/TeamCalendar";

export default function TeamCalendarPage() {
  const { setPageContext } = useAgent();
  useEffect(() => {
    setPageContext({ page: "Team calendar" });
  }, [setPageContext]);
  return (
    <Page title="Team calendar" subtitle="Counts, deliveries, visits and days off, shared by everyone in the workspace">
      <TeamCalendar />
    </Page>
  );
}
