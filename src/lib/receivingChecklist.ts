import type { Item, Receipt, ReceiptLine } from "@/lib/types";
import type { Store } from "@/lib/store/types";
import { activityOp, adjustStock, InventoryError, type Actor } from "@/lib/inventory";
import { escapeHtml, openPrintWindow } from "@/lib/print";
import { formatDateTime } from "@/lib/format";
import { nowIso, round } from "@/lib/utils";

/**
 * The receiving checklist: a printed sheet to take to the goods, ticked off
 * on paper or on screen, with the quantity found written next to each line.
 * A photo of the filled-in sheet can be read back by the scan route.
 */

export interface ChecklistRow {
  sku: string;
  name: string;
  qty: number;
  unit?: string;
  bin?: string;
  checked?: boolean;
  found?: number;
}

/** A sheet for a receipt (what arrived) or for an open purchase order (what is due). */
export function printReceivingChecklist(opts: { title: string; subtitle: string; rows: ChecklistRow[]; companyName: string; blankQty?: boolean }): boolean {
  const rows = opts.rows
    .map((r, i) => `<tr><td class="n">${i + 1}</td><td><span class="box">${r.checked ? "&#10003;" : ""}</span></td><td class="mono">${escapeHtml(r.sku)}</td><td>${escapeHtml(r.name)}</td><td class="n">${r.qty}${r.unit ? ` ${escapeHtml(r.unit)}` : ""}</td><td class="n">${opts.blankQty || r.found === undefined ? '<span class="blank"></span>' : r.found}</td><td class="mono">${escapeHtml(r.bin ?? "")}</td><td style="min-width:140px"></td></tr>`)
    .join("");
  const head = `<h1>${escapeHtml(opts.title)}</h1><div class="muted">${escapeHtml(opts.companyName)} · ${escapeHtml(opts.subtitle)} · ${opts.rows.length} lines · printed ${escapeHtml(formatDateTime(new Date().toISOString()))}</div>
<div style="margin-top:10px">Checked by: <span class="blank" style="min-width:180px"></span> &nbsp; Date: <span class="blank" style="min-width:120px"></span></div>
<p class="muted" style="margin:8px 0 0">Tick the box when the line is on the shelf. Write the quantity actually found in the Found column only when it differs. A photo of this sheet can be read back into cumulusOS.</p>`;
  const table = `<table><thead><tr><th class="n">#</th><th>Done</th><th>SKU</th><th>Item</th><th class="n">Expected</th><th class="n">Found</th><th>Bin</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>
<div class="muted" style="margin-top:10px;font-size:10.5px">Sheet id: ${escapeHtml(opts.subtitle)}</div>`;
  return openPrintWindow(opts.title, head + table, ".box{width:18px;height:18px;font-size:13px;text-align:center;line-height:18px}");
}

export interface ChecklistEntry {
  itemId: string;
  checked?: boolean;
  /** null clears a previously written quantity. */
  found?: number | null;
}

/** Lines where the quantity found differs from what the receipt booked. */
export function checklistDifferences(receipt: Receipt): Array<{ line: ReceiptLine; delta: number }> {
  return receipt.lines.filter((l) => l.found !== undefined && Math.abs(l.found - l.qty) > 1e-9).map((l) => ({ line: l, delta: round(l.found! - l.qty, 4) }));
}

/** Saves ticks and found quantities on the receipt's lines. */
export async function saveChecklist(store: Store, actor: Actor, receiptId: string, entries: ChecklistEntry[]): Promise<Receipt> {
  const receipt = await store.get("receipts", receiptId);
  if (!receipt) throw new InventoryError("Receipt not found");
  const byItem = new Map(entries.map((e) => [e.itemId, e]));
  const lines = receipt.lines.map((l) => {
    const e = byItem.get(l.itemId);
    if (!e) return l;
    const next: ReceiptLine = { ...l };
    if (e.checked !== undefined) next.checked = e.checked;
    if (e.found === null) delete next.found;
    else if (e.found !== undefined) {
      if (!Number.isFinite(e.found) || e.found < 0) throw new InventoryError("Found quantities must be zero or more");
      next.found = e.found;
    }
    return next;
  });
  const next: Receipt = { ...receipt, lines };
  await store.put("receipts", next);
  return next;
}

/**
 * Closes the checklist. When asked, the difference between what the receipt
 * booked and what was found is corrected with an adjustment per line, so the
 * shelf and the ledger agree without voiding the receipt.
 */
export async function completeChecklist(store: Store, actor: Actor, receiptId: string, opts: { adjust: boolean; source?: "manual" | "photo" }): Promise<{ receipt: Receipt; adjusted: number }> {
  const receipt = await store.get("receipts", receiptId);
  if (!receipt) throw new InventoryError("Receipt not found");
  if (receipt.status === "voided") throw new InventoryError(`${receipt.number} is voided`);
  const diffs = checklistDifferences(receipt);
  const items = await store.list("items");
  const byId = new Map(items.map((i) => [i.id, i]));
  let adjusted = 0;
  if (opts.adjust && diffs.length) {
    await adjustStock(
      store,
      actor,
      diffs.map((d) => ({ itemId: d.line.itemId, qtyDelta: d.delta, type: "adjustment" as const, reason: `Receiving checklist ${receipt.number}: found ${d.line.found}, booked ${d.line.qty}`, refType: "receipt" as const, refId: receipt.id })),
    );
    adjusted = diffs.length;
  }
  const next: Receipt = { ...receipt, checklist: { completedAt: nowIso(), completedBy: actor.id, source: opts.source ?? "manual", adjusted } };
  const ticked = receipt.lines.filter((l) => l.checked).length;
  const changes = diffs.map((d) => ({ sku: byId.get(d.line.itemId)?.sku ?? d.line.itemId, field: "found vs booked", from: d.line.qty, to: d.line.found }));
  await store.batch([
    { op: "put", collection: "receipts", doc: next },
    activityOp(actor, "stock.received", `${actor.name} checked ${receipt.number} on the shelf: ${ticked} of ${receipt.lines.length} lines ticked${diffs.length ? `, ${diffs.length} differed${opts.adjust ? " and stock was adjusted" : ""}` : ", everything matched"}`, { entityType: "receipt", entityId: receipt.id, meta: { checklist: true, ticked, differences: diffs.length, adjusted, changes, changesTotal: changes.length } }),
  ]);
  return { receipt: next, adjusted };
}

export function checklistRowsFor(receipt: Receipt, itemsById: Map<string, Item>): ChecklistRow[] {
  return receipt.lines.map((l) => {
    const item = itemsById.get(l.itemId);
    return { sku: item?.sku ?? l.itemId, name: item?.name ?? "", qty: l.qty, unit: item?.unit, bin: item?.location, checked: l.checked, found: l.found };
  });
}
