"use client";

import { ArrowRight } from "lucide-react";
import { useAgent } from "@/components/agent/AgentProvider";
import { QUICK_TASKS } from "./quickTasks";

export function QuickTasksGrid() {
  const { open } = useAgent();
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {QUICK_TASKS.map((task) => {
        const Icon = task.icon;
        return (
          <button
            key={task.id}
            type="button"
            onClick={() => open(task.prompt, { send: true })}
            className="card group flex items-start gap-3 p-4 text-left transition-colors hover:bg-surface-subdued"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-accent-soft text-accent">
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold leading-5 text-text">{task.title}</span>
              <span className="mt-0.5 block text-[12.5px] leading-[1.4] text-text-secondary">{task.description}</span>
            </span>
            <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-text-tertiary transition-colors group-hover:text-text" />
          </button>
        );
      })}
    </div>
  );
}
