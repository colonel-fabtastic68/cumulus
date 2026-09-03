"use client";

import { Sparkles } from "lucide-react";
import { useAgent } from "@/components/agent/AgentProvider";
import { Card } from "@/components/ui";
import { CardTitle } from "./CardTitle";

export function AgentSuggestionsCard({ suggestions }: { suggestions: string[] }) {
  const { open } = useAgent();
  return (
    <Card>
      <CardTitle icon={<Sparkles />} title="Agent suggestions" />
      <p className="mt-1 text-[12.5px] text-text-secondary">Prompts picked from what is happening in your workspace right now.</p>
      <div className="mt-3 flex flex-col gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => open(s, { send: true })}
            className="group flex w-full items-start gap-2 rounded-[var(--radius)] border border-border bg-surface px-3 py-2 text-left text-[12.5px] leading-[1.4] text-text transition-colors hover:border-border-strong hover:bg-surface-hover"
          >
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
            <span>{s}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
