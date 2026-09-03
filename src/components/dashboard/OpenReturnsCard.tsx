"use client";

import Link from "next/link";
import { RotateCcw } from "lucide-react";
import type { Item, Rma } from "@/lib/types";
import { formatRelative, pluralize } from "@/lib/format";
import { Badge, Card, StatusBadge } from "@/components/ui";
import { rmaUnits } from "./dashboardData";
import { CardLink, CardTitle } from "./CardTitle";

const MAX_ROWS = 5;

export function OpenReturnsCard({ rmas, itemsById }: { rmas: Rma[]; itemsById: Map<string, Item> }) {
  const visible = rmas.slice(0, MAX_ROWS);
  return (
    <Card padded={false}>
      <div className="px-4 pt-4 pb-3">
        <CardTitle
          icon={<RotateCcw />}
          title="Open returns"
          meta={rmas.length > 0 ? <Badge tone="info">{rmas.length}</Badge> : undefined}
          action={<CardLink href="/rmas">All returns</CardLink>}
        />
      </div>
      {visible.length === 0 ? (
        <p className="px-4 pb-4 text-[13px] text-text-secondary">No open returns. RMAs waiting for inspection will appear here.</p>
      ) : (
        <ul className="divide-y divide-border border-t border-border">
          {visible.map((r) => {
            const skus = r.lines.map((l) => `${itemsById.get(l.itemId)?.sku ?? "?"} ×${l.qty}`).join(" · ");
            return (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-surface-hover/70">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link href={"/rmas?highlight=" + r.id} className="font-mono text-[12px] font-medium text-accent hover:underline">
                      {r.number}
                    </Link>
                    <span className="truncate text-text">{r.customer}</span>
                    <StatusBadge status={r.status} />
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-text-secondary" title={`${r.reason} · ${skus}`}>
                    {r.reason} <span className="text-text-tertiary">· {skus}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right text-[12px] text-text-tertiary">
                  <div className="tabular text-text-secondary">{pluralize(rmaUnits(r), "unit")}</div>
                  <div title={r.createdAt}>{formatRelative(r.createdAt)}</div>
                </div>
              </li>
            );
          })}
          {rmas.length > visible.length && (
            <li className="px-4 py-2 text-[12.5px]">
              <Link href="/rmas" className="font-medium text-accent hover:underline">
                View all {rmas.length} open returns
              </Link>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}
