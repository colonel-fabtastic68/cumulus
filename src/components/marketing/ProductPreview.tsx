"use client";

import { Boxes, ClipboardList, Eye, FileBarChart2, Hammer, Home, PackageCheck, RotateCcw, Search, ShoppingCart, Sparkles, Truck } from "lucide-react";
import { Badge, Button, CloudMark, Kbd, SimpleTable } from "@/components/ui";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Home", icon: Home },
  { label: "Inventory", icon: Boxes, active: true },
  { label: "Receiving", icon: PackageCheck },
  { label: "Builds", icon: Hammer },
  { label: "Orders", icon: ShoppingCart },
  { label: "Returns", icon: RotateCcw },
  { label: "Suppliers", icon: Truck },
  { label: "Reports", icon: FileBarChart2 },
];

/** Demo rows in the shape of the seed workspace. Prices marked `proposed` are what Nimbus is previewing. */
const ROWS = [
  { sku: "ENC-125B-RAW", name: "1590B aluminium enclosure, raw", category: "Enclosures", onHand: "260", min: "100", price: "$10.45", proposed: true, status: "Active" },
  { sku: "SW-3PDT-BLU", name: "3PDT footswitch, blue", category: "Electronics", onHand: "320", min: "150", price: "$4.95", proposed: true, status: "Active" },
  { sku: "POT-A100K-16", name: "Potentiometer A100K 16mm", category: "Electronics", onHand: "720", min: "300", price: "$1.98", proposed: true, status: "Active" },
  { sku: "JK-DC-2.1", name: "DC power jack 2.1mm", category: "Electronics", onHand: "92", min: "200", price: "$1.50", proposed: false, status: "Low stock" },
  { sku: "FT-RUBBER-12", name: "Rubber foot, 12mm adhesive", category: "Hardware", onHand: "2,600", min: "800", price: "$0.25", proposed: false, status: "Active" },
];

/**
 * The app, rendered from its own components with demo data: inventory with a
 * bulk change previewed in the table, and Nimbus waiting for approval.
 * Decorative: not interactive, hidden from assistive tech.
 */
export function ProductPreview({ className }: { className?: string }) {
  return (
    <div className={cn("card select-none overflow-hidden text-[13px] leading-5", className)} aria-hidden>
      <div className="flex h-12 items-center gap-3 border-b border-border bg-nav-bg px-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-primary text-text-inverse">
          <CloudMark />
        </span>
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-surface px-3 text-text-tertiary shadow-[var(--shadow-100)] sm:max-w-sm">
          <Search className="h-3.5 w-3.5" />
          <span className="flex-1 truncate text-left">Search items, orders, suppliers</span>
          <Kbd>⌘K</Kbd>
        </div>
        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <Button variant="primary" size="md" icon={<Sparkles />}>
            Nimbus <Kbd>⌘J</Kbd>
          </Button>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#1f5f8b] text-[11px] font-semibold text-white">MO</span>
        </div>
      </div>

      <div className="grid md:grid-cols-[168px_minmax(0,1fr)] lg:grid-cols-[168px_minmax(0,1fr)_300px]">
        <aside className="hidden flex-col gap-0.5 border-r border-border bg-nav-bg p-3 md:flex">
          {NAV.map(({ label, icon: Icon, active }) => (
            <div key={label} className={cn("flex h-8 items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 font-[550]", active ? "bg-surface text-text shadow-[var(--shadow-100),0_0_0_1px_rgba(26,26,26,0.07)]" : "text-text")}>
              <Icon className={cn("h-4 w-4", active ? "text-text" : "text-icon")} />
              <span className="flex-1">{label}</span>
              {label === "Inventory" && <span className="rounded-full bg-warning-soft px-1.5 text-[11px] font-medium text-warning">1</span>}
            </div>
          ))}
          <div className="mt-4 mb-1 px-2.5 text-[12px] font-[550] text-text-secondary">Workspace</div>
          <div className="flex h-8 items-center gap-2.5 px-2.5 font-[550] text-text">
            <Sparkles className="h-4 w-4 text-icon" /> Nimbus
          </div>
          <div className="flex h-8 items-center gap-2.5 px-2.5 font-[550] text-text">
            <ClipboardList className="h-4 w-4 text-icon" /> Activity
          </div>
        </aside>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-[#ffd6a4] bg-[#fff4e5] px-4 py-2 text-[12.5px]">
            <span className="flex items-center gap-1.5 font-medium text-warning">
              <Eye className="h-4 w-4" /> Previewing: Update 3 items · Price +10%
            </span>
            <span className="text-text-secondary">3 items highlighted</span>
            <span className="ml-auto inline-flex rounded-[var(--radius-sm)] bg-surface p-0.5 shadow-[var(--shadow-button)]">
              <span className="rounded-[6px] px-2 py-0.5 text-text-secondary">Current</span>
              <span className="rounded-[6px] bg-primary px-2 py-0.5 text-text-inverse">Proposed</span>
            </span>
            <Button size="sm" className="hidden sm:inline-flex">
              Close preview
            </Button>
            <Button size="sm" variant="primary">
              Apply
            </Button>
          </div>
          <div className="px-4 pt-4 pb-1">
            <div className="text-[16px] font-semibold text-text">Inventory</div>
            <div className="text-[12.5px] text-text-secondary">46 items · 1 below minimum · value $18,420</div>
          </div>
          <div className="overflow-x-auto px-4 pb-4">
            <SimpleTable className="[&_td]:whitespace-nowrap">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th className="hidden md:table-cell">Category</th>
                  <th className="text-right">On hand</th>
                  <th className="hidden text-right lg:table-cell">Min</th>
                  <th className="text-right">Price</th>
                  <th className="hidden sm:table-cell">Status</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.sku} className={r.proposed ? "preview-row" : undefined}>
                    <td>
                      <div className="font-mono text-[12px] text-text">{r.sku}</div>
                      <div className="truncate text-[12px] text-text-secondary">{r.name}</div>
                    </td>
                    <td className="hidden md:table-cell">{r.category}</td>
                    <td className="text-right tabular">{r.onHand}</td>
                    <td className="hidden text-right tabular lg:table-cell">{r.min}</td>
                    <td className="text-right tabular">{r.price}</td>
                    <td className="hidden sm:table-cell">
                      <Badge tone={r.status === "Low stock" ? "warning" : "success"}>{r.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </SimpleTable>
          </div>
        </div>

        <aside className="hidden flex-col border-l border-border bg-surface lg:flex">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-text-inverse">
              <CloudMark />
            </span>
            <div className="leading-tight">
              <div className="font-semibold">Nimbus</div>
              <div className="text-[11.5px] text-text-tertiary">Asks before changing data</div>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-3 p-4">
            <div className="self-end rounded-[var(--radius)] bg-primary px-3 py-2 text-[12.5px] text-text-inverse">Raise prices in Enclosures and Electronics by 10%</div>
            <div className="rounded-[var(--radius-sm)] bg-surface-subdued px-2.5 py-1.5 text-[12px] text-text-secondary">Looked up 2 things · Workspace summary, Preview bulk update</div>
            <div className="rounded-[var(--radius)] border border-[rgba(94,66,0,0.3)] bg-surface shadow-[0_0_0_3px_#ffd6a4]">
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <Badge tone="warning">Needs approval</Badge>
                <span className="font-medium">Update 3 items</span>
              </div>
              <ul className="list-disc px-3 py-2 pl-7 text-[12.5px] text-text-secondary">
                <li>Fields: price</li>
                <li>Price +10%</li>
                <li>Reason: 10% increase across two categories</li>
              </ul>
              <div className="flex items-center gap-2 border-t border-border px-3 py-2">
                <Button size="sm" variant="primary" icon={<Eye />} className="mr-auto">
                  Previewing
                </Button>
                <Button size="sm">Reject</Button>
                <Button size="sm" variant="primary">
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
