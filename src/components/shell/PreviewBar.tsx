"use client";

import { useState } from "react";
import { Check, Eye, X } from "lucide-react";
import Link from "next/link";
import { usePreview } from "@/lib/store/provider";
import { Button, Segmented } from "@/components/ui";

/** Sticky strip shown while a proposed change is overlaid on the tables. */
export function PreviewBar() {
  const { preview, setPreview, setShowNew } = usePreview();
  const [applying, setApplying] = useState(false);
  if (!preview) return null;
  const count = Object.keys(preview.patches).length;

  const discard = () => {
    preview.onDiscard?.();
    setPreview(null);
  };

  return (
    <div className="sticky top-0 z-[40] flex flex-wrap items-center gap-3 border-b border-[#f5d9a8] bg-[#fff4e5] px-4 py-2 text-[13px]" role="status">
      <span className="inline-flex items-center gap-1.5 font-[550] text-[#5e4200]">
        <Eye className="h-4 w-4" /> Previewing: {preview.label}
      </span>
      <span className="text-[#5e4200]/80">
        {count} item{count === 1 ? "" : "s"} highlighted
      </span>
      <Segmented
        value={preview.showNew ? "new" : "old"}
        onChange={(v) => setShowNew(v === "new")}
        options={[
          { value: "old", label: "Current" },
          { value: "new", label: "Proposed" },
        ]}
      />
      <Link href="/inventory" className="text-accent hover:underline">
        Open inventory
      </Link>
      <span className="flex-1" />
      <Button size="sm" onClick={discard} icon={<X />}>
        Close preview
      </Button>
      {preview.apply && (
        <Button
          size="sm"
          variant="primary"
          icon={<Check />}
          loading={applying}
          onClick={async () => {
            setApplying(true);
            try {
              await preview.apply?.();
            } finally {
              setApplying(false);
              setPreview(null);
            }
          }}
        >
          Apply
        </Button>
      )}
    </div>
  );
}
