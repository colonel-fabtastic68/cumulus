"use client";

import { Trash2 } from "lucide-react";
import type { Item, Supplier } from "@/lib/types";
import { formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { IconButton, TextField } from "@/components/ui";
import { ItemPicker } from "@/components/inventory";

export interface LineDraft {
  key: string;
  item: Item | null;
  qty: string;
  unitCost: string;
  /** Focus the picker when the row mounts (rows added after the first). */
  autoFocus: boolean;
}

/** Column template shared by the header row and each line so they stay aligned. */
export const LINE_GRID = "sm:grid-cols-[minmax(0,1fr)_84px_116px_92px_32px]";

interface ReceiveLineRowProps {
  line: LineDraft;
  currency: string;
  symbol: string;
  supplierId?: string;
  suppliersById: Map<string, Supplier>;
  filter: (item: Item) => boolean;
  onPick: (item: Item | null) => void;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
  qtyRef: (el: HTMLInputElement | null) => void;
}

export function ReceiveLineRow({ line, currency, symbol, supplierId, suppliersById, filter, onPick, onChange, onRemove, qtyRef }: ReceiveLineRowProps) {
  const qty = Number(line.qty);
  const cost = line.unitCost.trim() === "" ? (line.item?.unitCost ?? 0) : Number(line.unitCost);
  const total = line.item && qty > 0 && Number.isFinite(cost) ? qty * cost : 0;
  const hint = lineHint(line, supplierId, suppliersById, currency);

  return (
    <div className="rounded-[var(--radius-sm)] border border-border p-2 sm:rounded-none sm:border-0 sm:p-0">
      <div className={cn("grid gap-2 sm:items-center", LINE_GRID)}>
        <div className="min-w-0">
          <ItemPicker value={line.item} onChange={onPick} filter={filter} autoFocus={line.autoFocus} placeholder="Search SKU or name" />
        </div>
        <div className="grid grid-cols-[1fr_1fr_1fr_32px] items-center gap-2 sm:contents">
          <TextField
            ref={qtyRef}
            type="number"
            min={0}
            step="any"
            placeholder="Qty"
            aria-label="Quantity"
            value={line.qty}
            onChange={(e) => onChange({ qty: e.target.value })}
            suffix={line.item && line.item.unit !== "ea" ? line.item.unit : undefined}
            className="text-right"
          />
          <TextField
            type="number"
            min={0}
            step="any"
            placeholder="Cost"
            aria-label="Unit cost"
            prefix={symbol}
            value={line.unitCost}
            onChange={(e) => onChange({ unitCost: e.target.value })}
            className="text-right"
          />
          <div className="text-right text-[13px] font-medium tabular">{line.item && qty > 0 ? formatMoney(total, currency) : <span className="text-text-tertiary">—</span>}</div>
          <IconButton variant="plain" onClick={onRemove} aria-label="Remove line" className="text-text-tertiary hover:text-critical">
            <Trash2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>
      {hint && <p className={cn("mt-1 text-[12px]", hint.tone === "warning" ? "text-warning" : "text-text-tertiary")}>{hint.text}</p>}
    </div>
  );
}

function lineHint(line: LineDraft, supplierId: string | undefined, suppliersById: Map<string, Supplier>, currency: string): { text: string; tone: "default" | "warning" } | null {
  const item = line.item;
  if (!item) return null;
  const parts: string[] = [];
  let tone: "default" | "warning" = "default";
  if (supplierId && item.supplierId && item.supplierId !== supplierId) {
    parts.push(`Usually from ${suppliersById.get(item.supplierId)?.name ?? "another supplier"}`);
    tone = "warning";
  } else if (supplierId && item.supplierId === supplierId && item.supplierSku) {
    parts.push(`Supplier SKU ${item.supplierSku}`);
  }
  const cost = Number(line.unitCost);
  if (line.unitCost.trim() !== "" && Number.isFinite(cost) && item.unitCost > 0 && Math.abs(cost - item.unitCost) > 0.0001) {
    const pct = ((cost - item.unitCost) / item.unitCost) * 100;
    parts.push(`Standard ${formatMoney(item.unitCost, currency)} (${pct > 0 ? "+" : ""}${formatPercent(pct, 1)})`);
  }
  return parts.length ? { text: parts.join(" · "), tone } : null;
}
