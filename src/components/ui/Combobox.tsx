"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "./Inputs";

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
}

export interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  label?: ReactNode;
  hint?: ReactNode;
  placeholder?: string;
  /** When set, typing something that is not an option offers to create it. */
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
  "aria-label"?: string;
}

/**
 * Polaris-style combobox: a text field that filters a listbox as you type,
 * arrow keys move the highlight, Enter selects, Escape closes without leaking
 * to a surrounding dialog, and an optional "Create …" row appears at the
 * bottom for values that do not exist yet.
 */
export function Combobox({ value, onChange, options, label, hint, placeholder = "Search…", onCreate, createLabel, disabled, className, size = "md", "aria-label": ariaLabel }: ComboboxProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q) || (o.description ?? "").toLowerCase().includes(q));
  }, [options, query]);
  const exact = options.some((o) => o.label.toLowerCase() === query.trim().toLowerCase());
  const canCreate = !!onCreate && query.trim().length > 0 && !exact;
  const rows = canCreate ? filtered.length + 1 : filtered.length;

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setIdx(0);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, close]);
  const pick = (v: string) => {
    onChange(v);
    close();
  };
  const create = () => {
    if (!canCreate) return;
    onCreate?.(query.trim());
    close();
  };
  const choose = (i: number) => {
    if (canCreate && i === filtered.length) create();
    else if (filtered[i]) pick(filtered[i].value);
  };

  const heightCls = size === "sm" ? "h-7 text-[12.5px]" : "h-8 text-[13px]";

  return (
    <div ref={ref} className={cn("relative", className)}>
      {label && (
        <Label htmlFor={id} hint={hint}>
          {label}
        </Label>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-label={label ? undefined : ariaLabel ?? placeholder}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && rows > 0 ? `${listId}-${idx}` : undefined}
          disabled={disabled}
          value={open ? query : selected?.label ?? ""}
          placeholder={open ? (selected?.label ?? placeholder) : placeholder}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setIdx((i) => Math.min(rows - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setIdx((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter") {
              if (open) {
                e.preventDefault();
                choose(idx);
              }
            } else if (e.key === "Escape") {
              if (open) {
                e.preventDefault();
                e.stopPropagation();
                close();
              }
            } else if (e.key === "Tab") {
              if (open) close();
            }
          }}
          className={cn(
            "w-full rounded-[var(--radius-sm)] border border-input-border bg-surface pl-3 pr-8 leading-5 text-text outline-none transition-[border-color,box-shadow] duration-100 placeholder:text-text-tertiary hover:border-input-border-hover focus:border-accent focus:ring-1 focus:ring-accent disabled:border-border disabled:bg-surface-subdued disabled:text-text-disabled",
            heightCls,
            !open && !selected && "text-text-tertiary",
          )}
        />
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
      </div>
      {open && (
        <div id={listId} role="listbox" className="absolute left-0 right-0 z-[80] mt-1 max-h-64 min-w-[220px] overflow-y-auto rounded-[var(--radius)] bg-surface p-1 shadow-[var(--shadow-pop)]">
          {filtered.length === 0 && !canCreate && <div className="px-3 py-3 text-center text-[12.5px] text-text-tertiary">No matches</div>}
          {filtered.map((o, i) => (
            <button
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === idx}
              type="button"
              onMouseEnter={() => setIdx(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o.value)}
              className={cn("flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-[13px]", i === idx && "bg-surface-hover")}
            >
              <span className="min-w-0">
                <span className="block truncate text-text">{o.label}</span>
                {o.description && <span className="block truncate text-[11.5px] text-text-tertiary">{o.description}</span>}
              </span>
              {o.value === value && <Check className="h-3.5 w-3.5 shrink-0 text-text-secondary" />}
            </button>
          ))}
          {canCreate && (
            <button
              id={`${listId}-${filtered.length}`}
              role="option"
              aria-selected={idx === filtered.length}
              type="button"
              onMouseEnter={() => setIdx(filtered.length)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={create}
              className={cn("mt-1 flex w-full items-center gap-2 rounded-[6px] border-t border-border px-2.5 py-2 text-left text-[13px] text-accent", idx === filtered.length && "bg-surface-hover")}
            >
              <Plus className="h-3.5 w-3.5" />
              {createLabel ? createLabel(query.trim()) : `Create “${query.trim()}”`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
