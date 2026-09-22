"use client";

import { Button } from "@/components/ui";
import { useSettings } from "@/lib/store/provider";

/** Sits above the top bar inside the public demo: what this is, and the two ways out. */
export function DemoBar() {
  const settings = useSettings();
  // A route handler, not a page: a full navigation, built as an absolute URL.
  const leave = (to?: string) => window.location.assign(new URL(to ? `/demo/exit?to=${encodeURIComponent(to)}` : "/demo/exit", window.location.origin).toString());
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-2 text-[12.5px] text-text-secondary">
      <span>
        <span className="font-medium text-text">Demo workspace</span> · {settings.companyName || "Halcyon Audio"} is a sample company. Changes stay in this browser.
      </span>
      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="tertiary" onClick={() => leave()}>
          Leave demo
        </Button>
        <Button size="sm" variant="primary" onClick={() => leave("/sign-up")}>
          Create your account
        </Button>
      </div>
    </div>
  );
}
