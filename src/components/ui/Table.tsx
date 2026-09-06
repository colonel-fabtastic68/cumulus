"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "./Inputs";
import { Button } from "./Button";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Value used for sorting. Omit to disable sorting on this column. */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: "left" | "right" | "center";
  width?: string;
  className?: string;
  /** Hide on narrow screens. */
  hideBelow?: "sm" | "md" | "lg";
}

export interface TableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Accessible label for a row's checkbox and keyboard target; defaults to the row key. */
  rowLabel?: (row: T) => string;
  selectable?: boolean;
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  emptyState?: ReactNode;
  pageSize?: number;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  /** Slot rendered above the table inside the card (filters, search). */
  toolbar?: ReactNode;
  /** Rendered when rows are selected, replaces toolbar. */
  bulkActions?: (selected: Set<string>) => ReactNode;
  footer?: ReactNode;
  dense?: boolean;
  className?: string;
  stickyHeader?: boolean;
}

const hideCls = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };

export function Table<T>({ rows, columns, rowKey, rowLabel, onRowClick, selectable, selected, onSelectedChange, emptyState, pageSize = 50, defaultSort, toolbar, bulkActions, footer, dense, className, stickyHeader = false }: TableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(defaultSort ?? null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    const sv = col.sortValue;
    return [...rows].sort((a, b) => {
      const va = sv(a);
      const vb = sv(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true });
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [rows, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const visible = sorted.slice(current * pageSize, current * pageSize + pageSize);
  const sel = selected ?? new Set<string>();
  const allVisibleSelected = visible.length > 0 && visible.every((r) => sel.has(rowKey(r)));
  const someSelected = visible.some((r) => sel.has(rowKey(r)));

  const toggleAll = () => {
    const next = new Set(sel);
    if (allVisibleSelected) visible.forEach((r) => next.delete(rowKey(r)));
    else visible.forEach((r) => next.add(rowKey(r)));
    onSelectedChange?.(next);
  };

  const toggle = (id: string) => {
    const next = new Set(sel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange?.(next);
  };

  const cellPad = dense ? "px-3 py-1.5" : "px-3 py-2";

  return (
    <div className={cn("card overflow-hidden", className)}>
      {(toolbar || (bulkActions && sel.size > 0)) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
          {bulkActions && sel.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] font-medium text-text">{sel.size} selected</span>
              {bulkActions(sel)}
              <Button size="sm" variant="plain" onClick={() => onSelectedChange?.(new Set())}>
                Clear
              </Button>
            </div>
          ) : (
            toolbar
          )}
        </div>
      )}
      <div className={cn("overflow-x-auto", stickyHeader && "max-h-[70vh] overflow-y-auto")}>
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead className={cn("bg-surface-subdued text-[12px] font-[550] text-text-secondary", stickyHeader && "sticky top-0 z-[1]")}>
            <tr>
              {selectable && (
                <th className={cn("w-9 border-b border-border", cellPad)}>
                  <Checkbox checked={allVisibleSelected} indeterminate={!allVisibleSelected && someSelected} onChange={toggleAll} aria-label="Select all rows on this page" />
                </th>
              )}
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    style={{ width: c.width }}
                    aria-sort={c.sortValue ? (active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none") : undefined}
                    className={cn("border-b border-border font-medium", cellPad, c.align === "right" && "text-right", c.align === "center" && "text-center", !c.align && "text-left", c.hideBelow && hideCls[c.hideBelow], c.className)}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        className={cn("inline-flex items-center gap-1 hover:text-text", active && "text-text")}
                        onClick={() => setSort(active ? { key: c.key, dir: sort!.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: "asc" })}
                      >
                        {c.header}
                        {active && (sort!.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-3 py-10 text-center text-text-tertiary">
                  {emptyState ?? "Nothing here yet."}
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const id = rowKey(row);
                const isSel = sel.has(id);
                const label = rowLabel ? rowLabel(row) : id;
                return (
                  <tr
                    key={id}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    aria-label={onRowClick ? `Open ${label}` : undefined}
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
                              e.preventDefault();
                              onRowClick(row);
                            }
                          }
                        : undefined
                    }
                    className={cn("border-b border-border last:border-b-0 focus-visible:bg-surface-hover focus-visible:outline-none", onRowClick && "cursor-pointer", isSel ? "bg-surface-selected" : "hover:bg-surface-hover/70")}
                  >
                    {selectable && (
                      <td className={cn(cellPad)} onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={isSel} onChange={() => toggle(id)} aria-label={`Select ${label}`} />
                      </td>
                    )}
                    {columns.map((c) => (
                      <td key={c.key} className={cn(cellPad, "align-middle", c.align === "right" && "text-right tabular", c.align === "center" && "text-center", c.hideBelow && hideCls[c.hideBelow], c.className)}>
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {(footer || pageCount > 1) && (
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-[12.5px] text-text-secondary">
          <div>{footer ?? `${sorted.length} row${sorted.length === 1 ? "" : "s"}`}</div>
          {pageCount > 1 && (
            <div className="flex items-center gap-1">
              <span>
                {current * pageSize + 1}–{Math.min(sorted.length, (current + 1) * pageSize)} of {sorted.length}
              </span>
              <Button size="sm" variant="plain" disabled={current === 0} onClick={() => setPage(current - 1)} aria-label="Previous page">
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="plain" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)} aria-label="Next page">
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Lightweight table for small inline lists (BOM lines, receipt lines).
 * Cell defaults come from the zero-specificity `.simple-table` rules in
 * globals.css, so consumers can override alignment and padding with plain
 * utility classes.
 */
export function SimpleTable({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto rounded-[var(--radius)] border border-border", className)}>
      <table className="simple-table w-full border-collapse text-left text-[13px]">{children}</table>
    </div>
  );
}
