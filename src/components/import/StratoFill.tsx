"use client";

import { useMemo, useState } from "react";
import { Sparkles, Undo2 } from "lucide-react";
import { Banner, Button, Card, Checkbox } from "@/components/ui";
import type { ImportRow } from "@/lib/inventory";
import type { Item } from "@/lib/types";
import { pluralize } from "@/lib/format";
import { useStratoImportApi } from "./api";
import type { ColumnMapping, ParsedSource, ReviewRow } from "./types";

type FillField = "sku" | "category" | "unit" | "type" | "levels" | "qty";

const FIELDS: Array<{ id: FillField; label: string; help: string }> = [
  { id: "sku", label: "SKUs", help: "Made from the name, in the style of the SKUs already here" },
  { id: "category", label: "Categories", help: "Consistent groups; existing categories are reused" },
  { id: "unit", label: "Units", help: "ea, kg, m, box… from the name or description" },
  { id: "levels", label: "Min / max levels", help: "A reorder point and target from the quantity, cost and kind of item" },
  { id: "type", label: "Part or assembly", help: "Kits and finished builds become assemblies" },
  { id: "qty", label: "Counts written in text", help: "Only when a count is spelled out in the row, never guessed" },
];

interface Suggestion {
  line: number;
  sku?: string;
  category?: string;
  unit?: string;
  type?: "part" | "assembly";
  minQty?: number;
  maxQty?: number;
  qty?: number;
  note?: string;
}

interface EnrichResponse {
  suggestions: Suggestion[];
  summary: string;
}

export type Overrides = Map<number, Partial<ImportRow>>;

const BATCH = 120;

interface StratoFillProps {
  source: ParsedSource;
  mapping: ColumnMapping;
  /** Review rows built without the fills, so gaps are counted against the file itself. */
  rows: ReviewRow[];
  itemsBySku: Map<string, Item>;
  overrides: Overrides;
  onOverrides: (next: Overrides) => void;
  hint?: string;
}

/**
 * Where the file left blanks, Strato proposes values: SKUs, categories, units,
 * min/max levels, part vs assembly, and counts that were written in words.
 * Nothing present in the file is ever changed, and the fills can be undone.
 */
export function StratoFill({ source, mapping, rows, itemsBySku, overrides, onOverrides, hint }: StratoFillProps) {
  const api = useStratoImportApi();
  const [fields, setFields] = useState<Set<FillField>>(() => new Set<FillField>(["sku", "category", "unit", "levels", "type"]));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const gaps = useMemo(() => {
    const g = { sku: 0, category: 0, unit: 0, type: 0, levels: 0, qty: 0 };
    for (const r of rows) {
      if (!r.sku) g.sku++;
      if (!r.row.category && !r.existing?.category) g.category++;
      if (!r.row.unit && !r.existing) g.unit++;
      if (!r.row.type && !r.existing) g.type++;
      if (r.row.minQty === undefined && r.row.maxQty === undefined && r.existing?.minQty === undefined) g.levels++;
      if (r.row.qty === undefined && !r.existing) g.qty++;
    }
    return g;
  }, [rows]);
  const anyGap = Object.values(gaps).some((n) => n > 0);
  const filled = useMemo(() => {
    const c = { rows: overrides.size, sku: 0, category: 0, unit: 0, type: 0, levels: 0, qty: 0 };
    for (const o of overrides.values()) {
      if (o.sku) c.sku++;
      if (o.category) c.category++;
      if (o.unit) c.unit++;
      if (o.type) c.type++;
      if (o.minQty !== undefined || o.maxQty !== undefined) c.levels++;
      if (o.qty !== undefined) c.qty++;
    }
    return c;
  }, [overrides]);

  const toggle = (f: FillField) =>
    setFields((cur) => {
      const next = new Set(cur);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  const run = async () => {
    if (fields.size === 0) return;
    setError(null);
    setSummary(null);
    const ignored = source.headers.filter((h) => (mapping[h] ?? "ignore") === "ignore");
    const wanted = rows.filter((r) => {
      if (fields.has("sku") && !r.sku) return true;
      if (r.existing) return false;
      if (fields.has("category") && !r.row.category) return true;
      if (fields.has("unit") && !r.row.unit) return true;
      if (fields.has("type") && !r.row.type) return true;
      if (fields.has("levels") && r.row.minQty === undefined && r.row.maxQty === undefined) return true;
      if (fields.has("qty") && r.row.qty === undefined) return true;
      return false;
    });
    if (wanted.length === 0) {
      setSummary("Nothing to fill in for the fields chosen.");
      return;
    }
    const workspaceSkus = Array.from(itemsBySku.keys());
    const categories = Array.from(new Set(Array.from(itemsBySku.values()).map((i) => i.category).filter((c): c is string => !!c))).slice(0, 60);
    const fileSkus = rows.map((r) => r.sku).filter(Boolean);
    const exampleSkus = [...workspaceSkus.slice(0, 15), ...fileSkus.slice(0, 10)];
    const taken = new Set<string>([...workspaceSkus, ...fileSkus.map((s) => s.toUpperCase())]);
    const fieldNames = Array.from(fields).flatMap((f) => (f === "levels" ? ["minQty", "maxQty"] : [f]));
    const next: Overrides = new Map(overrides);
    const notes: string[] = [];
    try {
      for (let i = 0; i < wanted.length; i += BATCH) {
        const batch = wanted.slice(i, i + BATCH);
        setBusy(wanted.length > BATCH ? `Strato is filling in rows ${i + 1}–${Math.min(i + BATCH, wanted.length)} of ${wanted.length}…` : "Strato is filling in the gaps…");
        const payload = batch.map((r) => {
          const src = source.rows[r.line - 1] ?? {};
          const extra: Record<string, string> = {};
          for (const h of ignored.slice(0, 4)) if (src[h]) extra[h] = src[h]!.slice(0, 120);
          const { sku, name, description, category, unit, qty, unitCost, price, minQty, maxQty, supplierName, type } = r.row;
          return { line: r.line, sku: sku || undefined, name, description: description?.slice(0, 300), category, unit, qty, unitCost, price, minQty, maxQty, supplierName, type, ...(Object.keys(extra).length ? { extra } : {}) };
        });
        const out = await api<EnrichResponse>("/api/import/enrich", { rows: payload, exampleSkus, categories, takenSkus: Array.from(taken).slice(0, 400), hint, fields: fieldNames });
        for (const s of out.suggestions) {
          const patch: Partial<ImportRow> = { ...(next.get(s.line) ?? {}) };
          if (fields.has("sku") && s.sku) {
            const sku = s.sku.toUpperCase();
            if (!taken.has(sku)) {
              taken.add(sku);
              patch.sku = sku;
            }
          }
          if (fields.has("category") && s.category) patch.category = s.category;
          if (fields.has("unit") && s.unit) patch.unit = s.unit;
          if (fields.has("type") && s.type) patch.type = s.type;
          if (fields.has("levels")) {
            if (s.minQty !== undefined) patch.minQty = s.minQty;
            if (s.maxQty !== undefined) patch.maxQty = s.maxQty;
          }
          if (fields.has("qty") && s.qty !== undefined) patch.qty = s.qty;
          if (Object.keys(patch).length) next.set(s.line, patch);
        }
        if (out.summary) notes.push(out.summary);
      }
      onOverrides(next);
      setSummary(notes.join(" ") || "Done.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!anyGap && overrides.size === 0) return null;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-text">
            <Sparkles className="h-4 w-4 text-magic" />
            Fill in the gaps with Strato
          </h3>
          <p className="mt-0.5 text-[12.5px] text-text-secondary">
            {overrides.size > 0
              ? `${pluralize(filled.rows, "row")} filled in${filled.sku ? `, ${filled.sku} SKUs` : ""}${filled.category ? `, ${filled.category} categories` : ""}${filled.unit ? `, ${filled.unit} units` : ""}${filled.levels ? `, ${filled.levels} min/max levels` : ""}${filled.qty ? `, ${filled.qty} counts` : ""}. Only blank cells were touched.`
              : "The file leaves some cells empty. Strato can propose values for them; nothing already in the file changes, and you can undo it."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {overrides.size > 0 && (
            <Button size="sm" variant="plain" icon={<Undo2 />} onClick={() => onOverrides(new Map())} disabled={!!busy}>
              Undo fills
            </Button>
          )}
          <Button size="sm" variant={overrides.size > 0 ? "secondary" : "primary"} icon={<Sparkles />} loading={!!busy} disabled={!!busy || fields.size === 0 || !anyGap} onClick={() => void run()}>
            {overrides.size > 0 ? "Fill again" : "Fill in with Strato"}
          </Button>
        </div>
      </div>
      <div className="mt-3 grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {FIELDS.map((f) => {
          const missing = gaps[f.id];
          return (
            <Checkbox
              key={f.id}
              checked={fields.has(f.id)}
              onChange={() => toggle(f.id)}
              disabled={!!busy || missing === 0}
              label={
                <span className="text-[12.5px]">
                  {f.label}
                  <span className="ml-1.5 text-text-tertiary">{missing === 0 ? "complete" : `${missing} missing`}</span>
                </span>
              }
              help={f.help}
            />
          );
        })}
      </div>
      {busy && <p className="mt-3 text-[12.5px] text-text-secondary">{busy}</p>}
      {summary && !busy && (
        <Banner tone="info" className="mt-3" onDismiss={() => setSummary(null)}>
          {summary}
        </Banner>
      )}
      {error && (
        <Banner tone={/Gemini key/.test(error) ? "warning" : "critical"} className="mt-3" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
    </Card>
  );
}
