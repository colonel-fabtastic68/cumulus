"use client";

import { ArrowRight, Boxes, Camera, Keyboard, MapPin, PackageCheck, SlidersHorizontal, Truck } from "lucide-react";
import { Badge, Banner, Button } from "@/components/ui";
import type { ScanResolution } from "@/lib/labels/entries";
import { formatQty } from "@/lib/format";

const MATCH_LABEL: Record<string, string> = { barcode: "Barcode", sku: "SKU", crossRef: "Cross-reference", channel: "Channel id" };
const KIND_LABEL: Record<ScanResolution["kind"], string> = { item: "Item", assembly: "Assembly", location: "Location", supplier: "Supplier", lot: "Batch" };

/** What a scanned code resolved to, with the next step: open it, receive it, count it. */
export function ScanResultCard({ code, result, onGo }: { code: string; result: ScanResolution | null; onGo: (href: string) => void }) {
  return (
    <div className="rounded-[var(--radius)] border border-border p-3">
      <div className="text-[12px] text-text-tertiary">
        Scanned <span className="font-mono text-text">{code}</span>
      </div>
      {!result ? (
        <Banner tone="warning" className="mt-2" title="Nothing matches that code">
          Add the barcode to the item, give the location a code, or add it as a cross-reference on the item&apos;s Cross-references tab, and it will scan next time.
        </Banner>
      ) : (
        <div className="mt-2">
          <div className="flex flex-wrap items-center gap-2">
            {result.subtitle && <span className="font-mono text-[12.5px] text-text">{result.subtitle}</span>}
            <span className="text-[13px] text-text">{result.title}</span>
            <Badge tone="info">
              {KIND_LABEL[result.kind]}
              {result.match ? ` · ${MATCH_LABEL[result.match.matchedBy]}${result.match.ref?.source ? ` · ${result.match.ref.source}` : ""}` : ""}
            </Badge>
          </div>
          {result.item && (
            <div className="mt-1 text-[12.5px] text-text-secondary">
              {formatQty(result.item.onHand, result.item.unit)} on hand{result.item.location ? ` · bin ${result.item.location}` : ""}
              {result.lot ? ` · ${formatQty(result.lot.qtyRemaining, result.item.unit)} left in this batch` : ""}
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" iconRight={<ArrowRight />} onClick={() => onGo(result.href)}>
              Open {KIND_LABEL[result.kind].toLowerCase()}
            </Button>
            {result.item && (result.kind === "item" || result.kind === "assembly") && (
              <>
                <Button size="sm" icon={<PackageCheck />} onClick={() => onGo(`/receiving?scan=${encodeURIComponent(result.item!.sku)}`)}>
                  Receive
                </Button>
                <Button size="sm" icon={<SlidersHorizontal />} onClick={() => onGo(`/inventory?adjust=${encodeURIComponent(result.item!.id)}`)}>
                  Count / adjust
                </Button>
              </>
            )}
            {result.kind === "location" && (
              <Button size="sm" icon={<Boxes />} onClick={() => onGo(`/inventory/counts?location=${encodeURIComponent(result.id)}`)}>
                Count this location
              </Button>
            )}
            {result.kind === "supplier" && (
              <Button size="sm" icon={<Truck />} onClick={() => onGo(`/orders/purchase?new=1&supplier=${encodeURIComponent(result.id)}`)}>
                New purchase order
              </Button>
            )}
          </div>
          <p className="mt-2 flex items-center gap-1 text-[11.5px] text-text-tertiary">
            <Keyboard className="h-3 w-3" /> Keep scanning to look up another code.
          </p>
          <span className="hidden">
            <Camera />
            <MapPin />
          </span>
        </div>
      )}
    </div>
  );
}
