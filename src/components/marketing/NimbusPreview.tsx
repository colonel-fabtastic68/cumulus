"use client";

import { Eye } from "lucide-react";
import { Badge, Button, CloudMark, SimpleTable } from "@/components/ui";

const CHANGES = [
  { sku: "ENC-125B-RAW", from: "$9.50", to: "$10.45" },
  { sku: "SW-3PDT-BLU", from: "$4.50", to: "$4.95" },
  { sku: "POT-A100K-16", from: "$1.80", to: "$1.98" },
];

/** One Nimbus turn, rendered from the app's components. Decorative. */
export function NimbusPreview() {
  return (
    <div className="card overflow-hidden text-[13px] leading-5" aria-hidden>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-text-inverse">
          <CloudMark />
        </span>
        <div className="leading-tight">
          <div className="font-semibold">Nimbus</div>
          <div className="text-[11.5px] text-text-tertiary">Asks before changing data</div>
        </div>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="max-w-[85%] self-end rounded-[var(--radius)] bg-primary px-3 py-2 text-text-inverse">Raise prices in Enclosures and Electronics by 10%</div>
        <div className="self-start rounded-[var(--radius-sm)] bg-surface-subdued px-2.5 py-1.5 text-[12px] text-text-secondary">Looked up 2 things · Workspace summary, Preview bulk update</div>
        <p className="text-text">Three active items match. Here is the change, previewed in your inventory table.</p>
        <div className="rounded-[var(--radius)] border border-[rgba(94,66,0,0.3)] bg-surface shadow-[0_0_0_3px_#ffd6a4]">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Badge tone="warning">Needs approval</Badge>
            <span className="font-medium">Update 3 items</span>
          </div>
          <div className="px-3 py-2">
            <SimpleTable>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {CHANGES.map((c) => (
                  <tr key={c.sku}>
                    <td className="font-mono text-[12px]">{c.sku}</td>
                    <td className="tabular">
                      price: {c.from} → {c.to}
                    </td>
                  </tr>
                ))}
              </tbody>
            </SimpleTable>
          </div>
          <div className="flex items-center gap-2 border-t border-border px-3 py-2">
            <Button size="sm" variant="tertiary" icon={<Eye />} className="mr-auto">
              Preview in table
            </Button>
            <Button size="sm">Reject</Button>
            <Button size="sm" variant="primary">
              Apply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
