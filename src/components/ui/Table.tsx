"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Columns3, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "./Inputs";
import { Button } from "./Button";

/** What a person changed about a table: column order, hidden columns and widths. Kept per browser under the layout key. */
export interface TableLayout {
  order?: string[];
  hidden?: string[];
  widths?: Record<string, number>;
}

const LAYOUT_EVENT = "cumulus:table-layout";

function readLayoutRaw(key: string): string {
  try {
    return localStorage.getItem(`cumulus:table:${key}`) ?? "";
  } catch {
    return "";
  }
}

function writeLayout(key: string, layout: TableLayout) {
  try {
    if (!layout.order?.length && !layout.hidden?.length && !Object.keys(layout.widths ?? {}).length) localStorage.removeItem(`cumulus:table:${key}`);
    else localStorage.setItem(`cumulus:table:${key}`, JSON.stringify(layout));
  } catch {
    // Private windows and blocked storage: the layout simply does not persist.
  }
  window.dispatchEvent(new Event(LAYOUT_EVENT));
}

function subscribeLayout(cb: () => void) {
  window.addEventListener(LAYOUT_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(LAYOUT_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** The saved layout for a key, kept in sync with storage; the server (and the first client frame) see the default. */
function useSavedLayout(key: string | undefined): TableLayout {
  const raw = useSyncExternalStore(subscribeLayout, () => (key ? readLayoutRaw(key) : ""), () => "");
  return useMemo(() => {
    if (!raw) return {};
    try {
      return JSON.parse(raw) as TableLayout;
    } catch {
      return {};
    }
  }, [raw]);
}

/** Applies a saved layout: reorders, drops hidden columns and pins resized ones. */
function applyLayout<T>(columns: Column<T>[], layout: TableLayout): Column<T>[] {
  const hidden = new Set(layout.hidden ?? []);
  const order = layout.order ?? [];
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const ordered = [...order.map((k) => byKey.get(k)).filter((c): c is Column<T> => !!c), ...columns.filter((c) => !order.includes(c.key))];
  return ordered
    .filter((c) => !hidden.has(c.key))
    .map((c) => {
      const w = layout.widths?.[c.key];
      return w ? { ...c, width: `${w}px`, minWidth: w, maxWidth: w, flex: false } : c;
    });
}

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
  /** Lets people show/hide, reorder and resize columns; the layout is remembered in this browser under the key. */
  layoutKey?: string;
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

export function Table<T>({ rows, columns: allColumns, rowKey, rowLabel, rowClassName, onRowClick, selectable, selected, onSelectedChange, emptyState, pageSize = 50, defaultSort, toolbar, bulkActions, footer, dense, className, stickyHeader = false, lockHeader = false, fit = false, columnDividers = false, layoutKey }: TableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(defaultSort ?? null);
  const layoutState = useSavedLayout(layoutKey);
  // Reads the stored layout fresh on every change so rapid drags never work from a stale render.
  const updateLayout = useCallback(
    (fn: (cur: TableLayout) => TableLayout) => {
      if (!layoutKey) return;
      let cur: TableLayout = {};
      try {
        cur = JSON.parse(readLayoutRaw(layoutKey) || "{}") as TableLayout;
      } catch {
        cur = {};
      }
      writeLayout(layoutKey, fn(cur));
    },
    [layoutKey],
  );
  const columns = useMemo(() => (layoutKey ? applyLayout(allColumns, layoutState) : allColumns), [allColumns, layoutState, layoutKey]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!columnsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (columnsRef.current && !columnsRef.current.contains(e.target as Node)) setColumnsOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [columnsOpen]);

  // Drag the right edge of a header to resize that column.
  const startResize = (key: string, startX: number, startWidth: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(48, Math.round(startWidth + (ev.clientX - startX)));
      updateLayout((cur) => ({ ...cur, widths: { ...(cur.widths ?? {}), [key]: w } }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const columnsMenu = layoutKey ? (
    <div ref={columnsRef} className="relative ml-auto">
      <Button size="sm" icon={<Columns3 />} onClick={() => setColumnsOpen((o) => !o)} aria-expanded={columnsOpen} aria-haspopup="dialog">
        Columns
      </Button>
      {columnsOpen && (
        <div role="dialog" aria-label="Choose columns" className="animate-menu absolute right-0 z-[60] mt-1 w-64 rounded-[var(--radius)] bg-surface p-2 shadow-[var(--shadow-pop)]">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-[12px] font-semibold text-text">Columns</span>
            <Button size="sm" variant="plain" icon={<RotateCcw />} onClick={() => updateLayout(() => ({}))}>
              Reset
            </Button>
          </div>
          <ul className="max-h-[50vh] overflow-y-auto">
            {(() => {
              const order = layoutState.order ?? [];
              const ordered = [...order.map((k) => allColumns.find((c) => c.key === k)).filter((c): c is Column<T> => !!c), ...allColumns.filter((c) => !order.includes(c.key))];
              const hidden = new Set(layoutState.hidden ?? []);
              const keys = ordered.map((c) => c.key);
              const move = (key: string, dir: -1 | 1) => {
                const i = keys.indexOf(key);
                const j = i + dir;
                if (j < 0 || j >= keys.length) return;
                const next = [...keys];
                [next[i], next[j]] = [next[j]!, next[i]!];
                updateLayout((cur) => ({ ...cur, order: next }));
              };
              return ordered.map((c, i) => (
                <li key={c.key} className="flex items-center gap-1 rounded-[6px] px-1 py-0.5 hover:bg-surface-hover">
                  <Checkbox
                    checked={!hidden.has(c.key)}
                    onChange={(on) => updateLayout((cur) => ({ ...cur, hidden: on ? (cur.hidden ?? []).filter((k) => k !== c.key) : [...(cur.hidden ?? []), c.key] }))}
                    label={<span className="text-[12.5px] text-text">{typeof c.header === "string" && c.header ? c.header : c.key}</span>}
                    className="min-w-0 flex-1"
                  />
                  <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => move(c.key, -1)} className="rounded p-0.5 text-text-tertiary hover:text-text disabled:opacity-30">
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" aria-label="Move down" disabled={i === ordered.length - 1} onClick={() => move(c.key, 1)} className="rounded p-0.5 text-text-tertiary hover:text-text disabled:opacity-30">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                </li>
              ));
            })()}
          </ul>
          <p className="mt-1 px-1 text-[11px] text-text-tertiary">Drag a header&apos;s right edge to resize. Saved in this browser.</p>
        </div>
      )}
    </div>
  ) : null;
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

  // Excel-style selection: Shift+click selects from the last clicked row to this one; Ctrl/Cmd+click adds or removes a row.
  const anchorRef = useRef<string | null>(null);
  const selectRange = (id: string) => {
    const keys = visible.map(rowKey);
    const a = anchorRef.current ? keys.indexOf(anchorRef.current) : -1;
    const b = keys.indexOf(id);
    if (b < 0) return;
    const [from, to] = a < 0 ? [b, b] : [Math.min(a, b), Math.max(a, b)];
    const next = new Set(sel);
    for (let i = from; i <= to; i++) next.add(keys[i]!);
    onSelectedChange?.(next);
  };
  /** True when the click was consumed as a selection gesture (so the row should not open). */
  const selectionClick = (e: React.MouseEvent, id: string): boolean => {
    if (!selectable) return false;
    if (e.shiftKey) {
      e.preventDefault();
      selectRange(id);
      return true;
    }
    if (e.metaKey || e.ctrlKey) {
      toggle(id);
      anchorRef.current = id;
      return true;
    }
    anchorRef.current = id;
    return false;
  };

  const cellPad = dense ? "px-3 py-1.5" : fit ? "px-(--cell-x) py-2 max-sm:py-2.5" : "px-3 py-2 max-sm:py-2.5";
  const checkPad = fit ? "w-9 px-2.5 py-2 max-sm:py-2.5" : cn("w-9", cellPad);
  const colLine = (i: number) => columnDividers && i > 0 && "border-l border-[color:var(--divider-soft)]";
  const visibility = (c: Column<T>) => c.hideBelow && hideCls[c.hideBelow];

  return (
    <div className={cn("card", lockHeader ? "overflow-visible" : "overflow-hidden", className)}>
      {(toolbar || columnsMenu || (bulkActions && sel.size > 0)) && (
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
            <>
              {toolbar}
              {columnsMenu}
            </>
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
                    className={cn("border-b border-[color:var(--divider)] font-medium", layoutKey && "relative", cellPad, fit && "whitespace-nowrap", colLine(i), c.align === "right" && "text-right", c.align === "center" && "text-center", !c.align && "text-left", visibility(c), c.className)}
                  >
                    {layoutKey && (
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${typeof c.header === "string" ? c.header : c.key}`}
                        onMouseDown={(e) => startResize(c.key, e.clientX, (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().width)(e)}
                        onDoubleClick={() => updateLayout((cur) => { const widths = { ...(cur.widths ?? {}) }; delete widths[c.key]; return { ...cur, widths }; })}
                        className="absolute inset-y-0 right-0 z-[1] w-2 cursor-col-resize select-none hover:bg-accent/30"
                        title="Drag to resize; double-click to reset"
                      />
                    )}
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
                    onMouseDown={selectable ? (e) => { if (e.shiftKey) e.preventDefault(); } : undefined}
                    onClick={
                      onRowClick || selectable
                        ? (e) => {
                            if (selectionClick(e, id)) return;
                            onRowClick?.(row);
                          }
                        : undefined
                    }
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
                      <td
                        className={checkPad}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (e.shiftKey) selectRange(id);
                          else {
                            toggle(id);
                            anchorRef.current = id;
                          }
                        }}
                      >
                        <Checkbox checked={isSel} onChange={() => {}} aria-label={`Select ${label}`} />
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
