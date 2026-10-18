"use client";

import { Toggle } from "@/components/ui";
import { pluralize } from "@/lib/format";

export interface RoutedLine {
  sku: string;
  /** The location the part's own routing names. */
  location: string;
}

interface Props {
  kind: "receive" | "fulfill";
  /** Lines whose part routes to somewhere other than the document's location. */
  lines: RoutedLine[];
  /** Name of the location the receipt or shipment itself names. */
  documentLocation: string;
  ignore: boolean;
  onIgnoreChange: (v: boolean) => void;
}

/**
 * Tells the person receiving or shipping which lines will land at (or leave from)
 * the part's own routed location instead of the one chosen on the form, with a
 * switch to send everything to the form's location for this document only.
 */
export function RoutingNotice({ kind, lines, documentLocation, ignore, onIgnoreChange }: Props) {
  if (lines.length === 0) return null;
  const shown = lines.slice(0, 6);
  const more = lines.length - shown.length;
  const list = `${shown.map((l) => `${l.sku} ${kind === "receive" ? "into" : "from"} ${l.location}`).join(", ")}${more > 0 ? ` and ${pluralize(more, "more line")}` : ""}`;
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius)] border border-border bg-surface-subdued px-3 py-2.5 text-[12.5px]">
      {ignore ? (
        <p className="text-text-secondary">
          Part routing is off for this {kind === "receive" ? "receipt" : "shipment"}: every line {kind === "receive" ? "lands at" : "is relieved from"} <span className="font-medium text-text">{documentLocation}</span>.
        </p>
      ) : (
        <p className="text-text-secondary">
          {pluralize(lines.length, "line")} {lines.length === 1 ? "follows" : "follow"} the part&apos;s own {kind === "receive" ? "receive" : "fulfillment"} location instead of {documentLocation}: <span className="text-text">{list}</span>.
        </p>
      )}
      <Toggle size="sm" label={kind === "receive" ? `Receive every line at ${documentLocation}, ignoring part routing` : `Relieve every line from ${documentLocation}, ignoring part routing`} checked={ignore} onChange={onIgnoreChange} />
    </div>
  );
}
