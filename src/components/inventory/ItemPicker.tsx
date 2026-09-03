"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { Item } from "@/lib/types";
import { useItems } from "@/lib/store/provider";
import { cn, matches } from "@/lib/utils";
import { formatQty } from "@/lib/format";
import { Label } from "@/components/ui";

export interface ItemPickerProps {
  value?: Item | null;
  onChange: (item: Item | null) => void;
  label?: string;
  placeholder?: string;
  /** Restrict the candidates (e.g. only assemblies, only active). */
  filter?: (item: Item) => boolean;
  exclude?: string[];
  autoFocus?: boolean;
  className?: string;
  disabled?: boolean;
}

/** Searchable combobox for choosing an item by SKU or name. */
export function ItemPicker({ value, onChange, label, placeholder = "Search SKU or name", filter, exclude, autoFocus, className, disabled }: ItemPickerProps) {
  const items = useItems();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const listId = `${inputId}-list`;

  const candidates = useMemo(() => {
    const ex = new Set(exclude ?? []);
    let rows = items.filter((i) => !ex.has(i.id) && (filter ? filter(i) : i.status === "active"));
    if (q.trim()) rows = rows.filter((i) => matches(q, i.sku, i.name, i.category, i.barcode));
    return rows.sort((a, b) => a.sku.localeCompare(b.sku)).slice(0, 8);
  }, [items, q, filter, exclude]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const pick = (item: Item) => {
    onChange(item);
    setQ("");
    setOpen(false);
  };

  return (
    <div ref={ref} className={cn("relative", className)}>
      {label && <Label htmlFor={inputId}>{label}</Label>}
      {value && !open ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setOpen(true);
            setQ("");
          }}
          className="flex h-8 w-full items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-border-strong/70 bg-surface px-2.5 text-left text-[13px] hover:border-border-strong disabled:opacity-60"
        >
          <span className="min-w-0 truncate">
            <span className="font-mono text-[12px] text-text-secondary">{value.sku}</span> <span className="text-text">{value.name}</span>
          </span>
          <span className="shrink-0 text-[12px] text-text-tertiary">{formatQty(value.onHand, value.unit)}</span>
        </button>
      ) : (
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
          <input
            id={inputId}
            role="combobox"
            aria-label={label ? undefined : placeholder}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && candidates[idx] ? `${listId}-${candidates[idx].id}` : undefined}
            autoFocus={autoFocus || (open && !!value)}
            disabled={disabled}
            value={q}
            placeholder={placeholder}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIdx((i) => Math.min(candidates.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (candidates[idx]) pick(candidates[idx]);
              } else if (e.key === "Escape") {
                if (open) {
                  // Consume it so a surrounding dialog does not close as well.
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                }
              }
            }}
            className="h-8 w-full rounded-[var(--radius-sm)] border border-border-strong/70 bg-surface pl-8 pr-2.5 text-[13px] outline-none placeholder:text-text-tertiary focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-surface-subdued"
          />
        </div>
      )}
      {open && (
        <div id={listId} role="listbox" className="absolute left-0 right-0 z-[70] mt-1 max-h-72 overflow-y-auto rounded-[var(--radius)] bg-surface p-1 shadow-[var(--shadow-pop)]">
          {candidates.length === 0 ? (
            <div className="px-3 py-3 text-center text-[12.5px] text-text-tertiary">No matching items</div>
          ) : (
            candidates.map((i, n) => (
              <button
                key={i.id}
                id={`${listId}-${i.id}`}
                role="option"
                aria-selected={n === idx}
                type="button"
                onMouseEnter={() => setIdx(n)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(i)}
                className={cn("flex w-full items-center justify-between gap-3 rounded-[6px] px-2.5 py-1.5 text-left text-[13px]", n === idx && "bg-surface-hover")}
              >
                <span className="min-w-0">
                  <span className="block truncate">
                    <span className="font-mono text-[12px] text-text-secondary">{i.sku}</span> <span>{i.name}</span>
                  </span>
                  <span className="block text-[11.5px] text-text-tertiary">{[i.category, i.location].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="shrink-0 text-[12px] text-text-secondary tabular">{formatQty(i.onHand, i.unit)}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
