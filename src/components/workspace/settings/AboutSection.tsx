"use client";

import { BookOpen, Sparkles } from "lucide-react";
import { Badge, Button, DescriptionList } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";

export const APP_VERSION = "0.1 MVP";

export function AboutSection() {
  const { mode } = useAuth();
  const { open } = useAgent();
  return (
    <div className="card flex flex-col gap-4 p-4">
      <DescriptionList
        rows={[
          {
            label: "Version",
            value: (
              <span className="inline-flex items-center gap-2">
                Cumulus {APP_VERSION}
                <Badge tone="accent">Pilot</Badge>
              </span>
            ),
          },
          { label: "Stack", value: "Next.js 16, React 19, Tailwind 4, Vercel AI SDK 7, Gemini" },
          { label: "Data", value: mode === "firestore" ? "Google Cloud Firestore" : "Local browser storage" },
          {
            label: "Docs",
            value: (
              <span>
                <code className="rounded bg-surface-hover px-1 font-mono text-[12px]">README.md</code> in the project root covers modes, the agent and every factor from the brief;{" "}
                <code className="rounded bg-surface-hover px-1 font-mono text-[12px]">docs/PILOT-GUIDE.md</code> is the walkthrough for pilot users.
              </span>
            ),
          },
        ]}
        className="[&_dd]:whitespace-normal"
      />
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        <Button icon={<BookOpen />} href="/agents">
          Agents and automations
        </Button>
        <Button icon={<Sparkles />} onClick={() => open("What can you do in this workspace? Give me a short tour of your read and write tools.", { send: true })}>
          Ask the agent for a tour
        </Button>
      </div>
    </div>
  );
}
