"use client";

import type { CycleCount, CycleCountStatus, Item, Location } from "@/lib/types";
import { describeScope, lineVariance } from "@/lib/cycleCounts";
import { formatDateTime } from "@/lib/format";
import { escapeHtml, openPrintWindow } from "@/lib/print";
import { Badge, type BadgeTone } from "@/components/ui";

export const COUNT_STATUS_LABEL: Record<CycleCountStatus, string> = { open: "Open", completed: "Completed", cancelled: "Cancelled" };
const TONE: Record<CycleCountStatus, BadgeTone> = { open: "info", completed: "success", cancelled: "default" };

export function CountStatusBadge({ status }: { status: CycleCountStatus }) {
  return <Badge tone={TONE[status]}>{COUNT_STATUS_LABEL[status]}</Badge>;
}

/** A count sheet to take to the shelf: one row per line with a box to tick and a blank for the quantity. */
export function printCountSheet(count: CycleCount, ctx: { items: Map<string, Item>; location?: Location; companyName: string; showExpected: boolean }): boolean {
  const rows = count.lines
    .map((l) => {
      const item = ctx.items.get(l.itemId);
      const v = lineVariance(l);
      return `<tr><td class="mono">${escapeHtml(l.bin ?? "")}</td><td class="mono">${escapeHtml(item?.sku ?? l.itemId)}</td><td>${escapeHtml(item?.name ?? "")}</td>${ctx.showExpected ? `<td class="n">${l.expected}</td>` : ""}<td class="n">${l.counted !== undefined ? l.counted : '<span class="blank"></span>'}</td>${ctx.showExpected ? `<td class="n">${v === undefined ? "" : v > 0 ? `+${v}` : v}</td>` : ""}<td><span class="box"></span></td><td style="min-width:120px">${escapeHtml(l.note ?? "")}</td></tr>`;
    })
    .join("");
  const head = `<h1>Count sheet ${escapeHtml(count.number)}${count.name ? ` · ${escapeHtml(count.name)}` : ""}</h1><div class="muted">${escapeHtml(ctx.companyName)} · ${escapeHtml(ctx.location?.name ?? "")} · ${escapeHtml(describeScope(count.scope))} · ${count.lines.length} lines · printed ${escapeHtml(formatDateTime(new Date().toISOString()))}</div>
<div style="margin-top:10px">Counted by: <span class="blank" style="min-width:180px"></span> &nbsp; Date: <span class="blank" style="min-width:120px"></span></div>`;
  const table = `<table><thead><tr><th>Bin</th><th>SKU</th><th>Item</th>${ctx.showExpected ? "<th class=\"n\">Expected</th>" : ""}<th class="n">Counted</th>${ctx.showExpected ? "<th class=\"n\">Diff</th>" : ""}<th>Done</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>`;
  return openPrintWindow(`${count.number} count sheet`, head + table);
}
