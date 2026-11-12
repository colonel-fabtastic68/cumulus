"use client";

import { useId, useMemo, useRef, useState } from "react";
import { CornerDownLeft } from "lucide-react";
import type { Item } from "@/lib/types";
import { useItems } from "@/lib/store/provider";
import { crossRefText, findItemByCode } from "@/lib/scan";
import { formatQty } from "@/lib/format";
import { cn, matches } from "@/lib/utils";
import { Kbd } from "@/components/ui";

export interface QuickLineEntryProps {
  /** Called with the chosen item and quantity; the row then clears for the next line. */
  onAdd: (item: Item, qty: number) => void;
  /** Restrict what can be entered (defaults to active items). */
  filter?: (item: Item) => boolean;
  /** The workspace's short word for the item code ("SKU", "PN"). */
  codeLabel: string;
  autoFocus?: boolean;
}

/**
 * Keyboard line entry for order forms, the way QuickBooks and Fishbowl do it:
 * type the part number, Enter; type the quantity, Enter; the line is added and
 * the cursor is back on the part number for the next one. A scanner works too
 * (it types the code and sends Enter). Hands never leave the keyboard.
 */
export function QuickLineEntry({ onAdd, filter, codeLabel, autoFocus }: QuickLineEntryProps) {
  const items = useItems();
  const [code, setCode] = useState("");
  const [qty, setQty] = useState("1");
  const [item, setItem] = useState<Item | null>(null);
  const [idx, setIdx] = useState(0);
  const [focused, setFocused] = useState(false);
  const [miss, setMiss] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const pool = useMemo(() => items.filter((i) => (filter ? filter(i) : i.status === "active")), [items, filter]);
  const suggestions = useMemo(() => {
    const q = code.trim();
    if (!q || item) return [];
    const lower = q.toLowerCase();
    // Codes that start with what was typed come first, then anything that mentions it.
    const starts = pool.filter((i) => i.sku.toLowerCase().startsWith(lower));
    const rest = pool.filter((i) => !i.sku.toLowerCase().startsWith(lower) && matches(q, i.sku, i.name, i.barcode, crossRefText(i)));
    return [...starts.sort((a, b) => a.sku.localeCompare(b.sku)), ...rest.sort((a, b) => a.sku.localeCompare(b.sku))].slice(0, 8);
  }, [pool, code, item]);

  const choose = (picked: Item) => {
    setItem(picked);
    setCode(picked.sku);
    setMiss(null);
    // Focus after the state has landed so the quantity is selected and ready to overtype.
    setTimeout(() => {
      qtyRef.current?.focus();
      qtyRef.current?.select();
    }, 0);
  };

  const resolve = () => {
    const typed = code.trim();
    if (!typed) return;
    // An exact code (part number, barcode, cross-reference) wins over whatever is highlighted: that is what a scanner sends.
    const exact = findItemByCode(pool, typed)?.item;
    const picked = exact ?? suggestions[idx];
    if (picked) choose(picked);
    else setMiss(`No item matches “${typed}”`);
  };

  const reset = () => {
    setItem(null);
    setCode("");
    setQty("1");
    setIdx(0);
    setMiss(null);
    setTimeout(() => codeRef.current?.focus(), 0);
  };

  const commit = () => {
    const n = Number(qty);
    if (!item) return resolve();
    if (!Number.isFinite(n) || n <= 0) return setMiss("Enter a quantity above zero");
    onAdd(item, n);
    reset();
  };

  const field = "h-8 rounded-[var(--radius-sm)] border border-border-strong/70 bg-surface px-2.5 text-[13px] outline-none placeholder:text-text-tertiary focus:border-accent focus:ring-2 focus:ring-accent/20";

  return (
    <div className="border-t border-border bg-surface px-3 py-2">
      <div className="flex flex-wrap items-start gap-2">
        <div className="relative min-w-0 flex-1 basis-56">
          <input
            ref={codeRef}
            role="combobox"
            aria-label={`${codeLabel} for the next line`}
            aria-expanded={focused && suggestions.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            autoFocus={autoFocus}
            value={code}
            placeholder={`${codeLabel}, name or barcode`}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              setCode(e.target.value);
              setItem(null);
              setIdx(0);
              setMiss(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                resolve();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((i) => Math.min(suggestions.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Escape" && code) {
                // Clear the entry instead of closing the form around it.
                e.preventDefault();
                e.stopPropagation();
                reset();
              }
            }}
            className={cn(field, "w-full font-mono")}
          />
          {focused && suggestions.length > 0 && (
            <div id={listId} role="listbox" className="absolute left-0 right-0 z-[70] mt-1 max-h-64 overflow-y-auto rounded-[var(--radius)] bg-surface p-1 shadow-[var(--shadow-pop)]">
              {suggestions.map((s, n) => (
                <button key={s.id} type="button" role="option" aria-selected={n === idx} onMouseEnter={() => setIdx(n)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(s)} className={cn("flex w-full items-center justify-between gap-3 rounded-[6px] px-2.5 py-1.5 text-left text-[13px]", n === idx && "bg-surface-hover")}>
                  <span className="min-w-0 truncate">
                    <span className="font-mono text-[12px] text-text-secondary">{s.sku}</span> <span>{s.name}</span>
                  </span>
                  <span className="shrink-0 text-[12px] tabular text-text-secondary">{formatQty(s.onHand, s.unit)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          ref={qtyRef}
          type="number"
          min={0}
          step="any"
          aria-label="Quantity for the next line"
          value={qty}
          onChange={(e) => {
            setQty(e.target.value);
            setMiss(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape" && item) {
              e.preventDefault();
              e.stopPropagation();
              reset();
            }
          }}
          className={cn(field, "w-24 text-right tabular")}
        />
        <button type="button" onClick={commit} disabled={!code.trim()} className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-border-strong/70 px-2.5 text-[12.5px] font-medium text-text hover:bg-surface-hover disabled:opacity-50">
          <CornerDownLeft className="h-3.5 w-3.5" /> Add
        </button>
      </div>
      <p className={cn("mt-1 text-[12px]", miss ? "text-critical" : "text-text-tertiary")} aria-live="polite">
        {miss ?? (item ? `${item.name} · ${formatQty(item.onHand, item.unit)} on hand. Type the quantity and press Enter.` : (
          <>
            Type a {codeLabel} and press <Kbd>Enter</Kbd>, then the quantity and <Kbd>Enter</Kbd>. The next line opens by itself.
          </>
        ))}
      </p>
    </div>
  );
}
