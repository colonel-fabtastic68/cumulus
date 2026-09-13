"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
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
  /** Hide on narrow screens (viewport breakpoints). */
  hideBelow?: "sm" | "md" | "lg";
  /** Fit mode: the narrowest the column may get, in px (content plus about 18px of padding). */
  minWidth?: number;
  /** Fit mode: stop growing past this width; spare room goes to the flex column instead. */
  maxWidth?: number;
  /** Fit mode: this column absorbs whatever width is left (one per table). */
  flex?: boolean;
  /** Fit mode: when the card is too narrow for every column, lower priorities are hidden first. Leave unset to always show the column. */
  priority?: number;
}

export interface TableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Accessible label for a row's checkbox and keyboard target; defaults to the row key. */
  rowLabel?: (row: T) => string;
  /** Extra classes per row (e.g. a preview highlight). */
  rowClassName?: (row: T) => string | undefined;
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
  /** Scroll inside the card with the header pinned (for tables inside dialogs). */
  stickyHeader?: boolean;
  /** Keep the column header visible while the page scrolls. The card stops clipping, so use it on full-width list pages. */
  lockHeader?: boolean;
  /**
   * Fit the columns to the card: the table measures its own width, hides the lowest-priority columns only when the
   * minimums no longer fit, grows the rest toward their maximums and gives the remainder to the flex column. Headers
   * stay on one line, cells truncate, and gutters follow the content width.
   */
  fit?: boolean;
  /** Faint vertical hairlines between columns, for tables with many numeric columns. */
  columnDividers?: boolean;
}

const hideCls = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" };
const MIN_TABLE_WIDTH = 640;
const CHECK_WIDTH = 36;

/**
 * Fit-mode layout: drop the lowest-priority columns until every minimum fits, grow the rest toward their maximums
 * with half of the spare room, and hand the remainder to the flex column. `width` is the room for the data columns;
 * null (not measured yet) lays everything out at its minimum.
 */
function fitColumns<T>(columns: Column<T>[], width: number | null): { cols: Column<T>[]; widths: Map<string, number> } {
  const minOf = (c: Column<T>) => c.minWidth ?? 80;
  const roomOf = (c: Column<T>) => Math.max(0, (c.maxWidth ?? minOf(c)) - minOf(c));
  let cols = columns;
  if (width !== null) {
    for (;;) {
      if (cols.reduce((s, c) => s + minOf(c), 0) <= width) break;
      const droppable = cols.filter((c) => c.priority !== undefined);
      if (droppable.length === 0) break;
      const victim = droppable.reduce((a, b) => (b.priority! < a.priority! ? b : a));
      cols = cols.filter((c) => c !== victim);
    }
  }
  const need = cols.reduce((s, c) => s + minOf(c), 0);
  const total = width ?? need;
  const flex = cols.find((c) => c.flex) ?? cols[0];
  const others = cols.filter((c) => c !== flex);
  const capacity = others.reduce((s, c) => s + roomOf(c), 0);
  const growth = Math.min(Math.max(0, total - need) / 2, capacity);
  const widths = new Map<string, number>();
  let used = 0;
  for (const c of others) {
    const w = minOf(c) + (capacity > 0 ? (growth * roomOf(c)) / capacity : 0);
    widths.set(c.key, w);
    used += w;
  }
  if (flex) widths.set(flex.key, Math.max(minOf(flex), total - used));
  return { cols, widths };
}

export function Table<T>({ rows, columns, rowKey, rowLabel, rowClassName, onRowClick, selectable, selected, onSelectedChange, emptyState, pageSize = 50, defaultSort, toolbar, bulkActions, footer, dense, className, stickyHeader = false, lockHeader = false, fit = false, columnDividers = false }: TableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(defaultSort ?? null);
  const [page, setPage] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [fitWidth, setFitWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!fit || !el) return;
    const ro = new ResizeObserver(() => {
      const next = el.clientWidth;
      // Resize callbacks run before paint, so the first layout on screen is already the fitted one.
      flushSync(() => setFitWidth((prev) => (prev === next ? prev : next)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const layout = useMemo(
    () => (fit ? fitColumns(columns, fitWidth === null ? null : Math.max(fitWidth, MIN_TABLE_WIDTH) - (selectable ? CHECK_WIDTH : 0)) : null),
    [fit, columns, fitWidth, selectable],
  );
  const shown = layout ? layout.cols : columns;

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

  const cellPad = dense ? "px-3 py-1.5" : fit ? "px-(--cell-x) py-2 max-sm:py-2.5" : "px-3 py-2 max-sm:py-2.5";
  const checkPad = fit ? "w-9 px-2.5 py-2 max-sm:py-2.5" : cn("w-9", cellPad);
  const colLine = (i: number) => columnDividers && i > 0 && "border-l border-[color:var(--divider-soft)]";
  const visibility = (c: Column<T>) => c.hideBelow && hideCls[c.hideBelow];

  return (
    <div className={cn("card", lockHeader ? "overflow-visible" : "overflow-hidden", className)}>
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
      <div ref={wrapRef} className={cn(lockHeader ? "overflow-x-auto md:overflow-visible" : "overflow-x-auto", stickyHeader && "max-h-[70vh] overflow-y-auto")}>
        <table className={cn("w-full min-w-[640px] border-collapse text-[13px] max-sm:text-[14px]", fit && "table-fit table-fixed")}>
          <thead className={cn("bg-surface-subdued text-[12px] font-[550] text-text-secondary max-sm:text-[12.5px]", (stickyHeader || lockHeader) && "sticky top-0 z-[2]", lockHeader && "shadow-[0_1px_0_var(--divider)]")}>
            <tr>
              {selectable && (
                <th className={cn("border-b border-[color:var(--divider)]", checkPad)}>
                  <Checkbox checked={allVisibleSelected} indeterminate={!allVisibleSelected && someSelected} onChange={toggleAll} aria-label="Select all rows on this page" />
                </th>
              )}
              {shown.map((c, i) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    style={{ width: layout ? layout.widths.get(c.key) : c.width }}
                    aria-sort={c.sortValue ? (active ? (sort!.dir === "asc" ? "ascending" : "descending") : "none") : undefined}
                    className={cn("border-b border-[color:var(--divider)] font-medium", cellPad, fit && "whitespace-nowrap", colLine(i), c.align === "right" && "text-right", c.align === "center" && "text-center", !c.align && "text-left", visibility(c), c.className)}
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
                <td colSpan={shown.length + (selectable ? 1 : 0)} className="px-3 py-10 text-center text-text-tertiary">
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
                    className={cn("border-b border-[color:var(--divider)] last:border-b-0 focus-visible:bg-surface-hover focus-visible:outline-none", onRowClick && "cursor-pointer", isSel ? "bg-surface-selected" : "hover:bg-surface-hover/70", rowClassName?.(row))}
                  >
                    {selectable && (
                      <td className={checkPad} onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={isSel} onChange={() => toggle(id)} aria-label={`Select ${label}`} />
                      </td>
                    )}
                    {shown.map((c, i) => (
                      <td key={c.key} className={cn(cellPad, "align-middle", fit && "overflow-hidden text-ellipsis whitespace-nowrap", colLine(i), c.align === "right" && "text-right tabular", c.align === "center" && "text-center", visibility(c), c.className)}>
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
