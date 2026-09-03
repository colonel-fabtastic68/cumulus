"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * A settings panel: white card, padded body, and an optional footer with a
 * Save button. Pass `readOnly` to hide the footer for people who cannot save.
 */
export function SettingsCard({
  children,
  onSave,
  saving,
  dirty = true,
  readOnly,
  saveLabel = "Save",
  footerNote,
  className,
}: {
  children: ReactNode;
  onSave?: () => void;
  saving?: boolean;
  dirty?: boolean;
  readOnly?: boolean;
  saveLabel?: string;
  footerNote?: ReactNode;
  className?: string;
}) {
  const showFooter = !!onSave && !readOnly;
  return (
    <div className={cn("card overflow-hidden", className)}>
      <div className="flex flex-col gap-4 p-4">{children}</div>
      {showFooter && (
        <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-subdued px-4 py-2.5">
          <span className="text-[12px] text-text-tertiary">{footerNote}</span>
          <Button variant="primary" size="sm" onClick={onSave} loading={saving} disabled={!dirty}>
            {saveLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
