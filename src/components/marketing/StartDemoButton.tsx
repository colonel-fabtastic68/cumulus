"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui";
import { clearLocalWorkspace } from "@/lib/store/local";

/**
 * Opens the demo. The start route sets the demo cookie and redirects into the
 * workspace; these are plain navigations, not links, so nothing prefetches a
 * route that sets cookies.
 */
export function StartDemoButton({ fresh, children, variant = "primary" }: { fresh?: boolean; children: React.ReactNode; variant?: "primary" | "secondary" }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant={variant}
      size="lg"
      loading={busy}
      iconRight={variant === "primary" ? <ArrowRight /> : undefined}
      onClick={() => {
        setBusy(true);
        if (fresh) clearLocalWorkspace();
        // A route handler, not a page: a full navigation, built as an absolute URL.
        window.location.assign(new URL("/demo/start", window.location.origin).toString());
      }}
    >
      {children}
    </Button>
  );
}
