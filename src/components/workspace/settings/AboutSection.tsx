"use client";

import { BookOpen, Sparkles } from "lucide-react";
import { Button } from "@/components/ui";
import { useAgent } from "@/components/agent/AgentProvider";

export const APP_VERSION = "0.0.3";
/** When this version went out. */
export const APP_RELEASED = "2026-10-28";

export function AboutSection() {
  const { open } = useAgent();
  const released = new Date(`${APP_RELEASED}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return (
    <div className="card flex flex-col gap-4 p-4">
      <div>
        <div className="text-[14px] font-semibold text-text">cumulusOS™ · Version {APP_VERSION}</div>
        <div className="mt-1 text-[13px] text-text-secondary">Proudly North Carolinian.</div>
        <div className="mt-2 text-[12px] text-text-tertiary">
          Released {released} · © {APP_RELEASED.slice(0, 4)} cumulusOS. cumulusOS and Strato are trademarks of cumulusOS. All rights reserved.
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button icon={<BookOpen />} href="/agents">
          Agents and automations
        </Button>
        <Button icon={<Sparkles />} onClick={() => open("What can you do in this workspace? Give me a short tour of your read and write tools.", { send: true })}>
          Ask Strato for a tour
        </Button>
      </div>
    </div>
  );
}
