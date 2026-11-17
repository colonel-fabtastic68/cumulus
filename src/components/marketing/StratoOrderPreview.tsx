"use client";

import { Badge, Button, CloudMark, SimpleTable } from "@/components/ui";

/** Lines from the sample company (src/lib/seed.ts): the Overdrive at its 5+ price, the Delay one short of the three on the shelf. */
const LINES = [
  { sku: "FG-OD1-WHT", qty: 6, price: "$159.00", stock: "In stock", short: false },
  { sku: "FG-DLY1-BLK", qty: 4, price: "$249.00", stock: "1 short", short: true },
];

/** One Strato turn on an order, rendered from the app's components. Decorative. */
export function StratoOrderPreview() {
  return (
    <div className="card overflow-hidden text-[13px] leading-5" aria-hidden>
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-text-inverse">
          <CloudMark />
        </span>
        <div className="leading-tight">
          <div className="font-semibold">Strato</div>
          <div className="text-[12px] text-text-tertiary">Asks before changing data</div>
        </div>
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="max-w-[85%] self-end rounded-[var(--radius)] bg-primary px-3 py-2 text-text-inverse">New order from Ridge Sound Studio: 6 Overdrive in white, 4 Delay in black</div>
        <div className="self-start rounded-[var(--radius-sm)] bg-surface-subdued px-2.5 py-1.5 text-[12px] text-text-secondary">Looked up 3 things · Search items, Item detail, Explode BOM</div>
        <p className="text-text">Both lines match your catalog, with the 5+ price on the Overdrive. The Delay is 1 short of the 3 on the shelf.</p>
        <div className="rounded-[var(--radius)] border border-[rgba(94,66,0,0.3)] bg-surface shadow-[0_0_0_3px_#ffd6a4]">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Badge tone="warning">Needs approval</Badge>
            <span className="font-medium">Create sales order</span>
          </div>
          <div className="px-3 py-2">
            <SimpleTable>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th className="text-right">Qty</th>
                  <th className="text-right">Price</th>
                  <th>Stock</th>
                </tr>
              </thead>
              <tbody>
                {LINES.map((l) => (
                  <tr key={l.sku}>
                    <td className="font-mono text-[12px]">{l.sku}</td>
                    <td className="tabular text-right">{l.qty}</td>
                    <td className="tabular text-right">{l.price}</td>
                    <td className={l.short ? "font-medium text-brand-red" : "text-text-secondary"}>{l.stock}</td>
                  </tr>
                ))}
              </tbody>
            </SimpleTable>
            <div className="flex items-center justify-between border-t border-border pt-2 text-[12px] text-text-secondary">
              <span>Ridge Sound Studio</span>
              <span className="tabular font-medium text-text">Total $1,950.00</span>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
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
