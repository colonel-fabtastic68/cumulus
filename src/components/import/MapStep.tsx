"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCcw, Sparkles } from "lucide-react";
import { Badge, Banner, Button, Card, Select, SimpleTable, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";
import { guessMapping, invertMapping, isMappingTarget, setMappingTarget } from "./mapping";
import { FIELD_LABELS, TARGET_FIELDS, type ColumnMapping, type MappingTarget, type ParsedSource, type TargetField } from "./types";

const TARGET_OPTIONS: Array<{ value: MappingTarget; label: string }> = [
  ...TARGET_FIELDS.map((f) => ({ value: f, label: FIELD_LABELS[f] })),
  { value: "ignore", label: FIELD_LABELS.ignore },
];

const KIND_HINT = {
  shopify: "This looks like a Shopify product export. Variant SKU, Title, Variant Inventory Qty and Cost per item were mapped automatically.",
  woocommerce: "This looks like a WooCommerce product export. SKU, Name, Stock, Regular price and Categories were mapped automatically.",
  generic: null,
} as const;

interface AiMappingResponse {
  mappings?: Array<{ column?: unknown; field?: unknown; confidence?: unknown }>;
  notes?: unknown;
}

interface MapStepProps {
  source: ParsedSource;
  mapping: ColumnMapping;
  onMappingChange: (mapping: ColumnMapping) => void;
  onBack: () => void;
  onContinue: () => void;
}

export function MapStep({ source, mapping, onMappingChange, onBack, onContinue }: MapStepProps) {
  const toast = useToast();
  const [aiBusy, setAiBusy] = useState(false);
  const [aiHint, setAiHint] = useState<{ tone: "info" | "warning"; text: string } | null>(null);

  const cols = useMemo(() => invertMapping(mapping), [mapping]);
  const mappedFields = useMemo(() => TARGET_FIELDS.filter((f) => cols[f] !== undefined), [cols]);
  const preview = useMemo(() => source.rows.slice(0, 5), [source.rows]);
  const samples = useMemo(() => {
    const out: Record<string, string> = {};
    for (const h of source.headers) out[h] = source.rows.find((r) => r[h])?.[h] ?? "";
    return out;
  }, [source]);

  const skuMapped = cols.sku !== undefined;
  const nameMapped = cols.name !== undefined;

  const mapWithAi = async () => {
    setAiBusy(true);
    setAiHint(null);
    try {
      const res = await fetch("/api/map-columns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headers: source.headers, sample: source.rows.slice(0, 5) }),
      });
      if (res.status === 503) {
        setAiHint({ tone: "warning", text: "AI mapping needs a Gemini key. Add GOOGLE_GENERATIVE_AI_API_KEY to .env.local and restart the dev server, or keep mapping by hand." });
        return;
      }
      if (!res.ok) throw new Error(`Mapping service returned ${res.status}`);
      const data = (await res.json()) as AiMappingResponse;
      const headerSet = new Set(source.headers);
      let next: ColumnMapping = Object.fromEntries(source.headers.map((h) => [h, "ignore" as MappingTarget]));
      let applied = 0;
      for (const m of data.mappings ?? []) {
        if (typeof m.column !== "string" || !headerSet.has(m.column) || !isMappingTarget(m.field)) continue;
        if (m.field !== "ignore" && typeof m.confidence === "number" && m.confidence < 0.3) continue;
        next = setMappingTarget(next, m.column, m.field);
        if (m.field !== "ignore") applied++;
      }
      onMappingChange(next);
      toast(`AI mapped ${applied} column${applied === 1 ? "" : "s"}`, "success");
      if (typeof data.notes === "string" && data.notes.trim()) setAiHint({ tone: "info", text: data.notes.trim() });
    } catch (err) {
      toast(err instanceof Error ? err.message : "AI mapping failed", "critical");
    } finally {
      setAiBusy(false);
    }
  };

  const kindHint = KIND_HINT[source.kind];

  return (
    <div className="flex flex-col gap-4">
      {kindHint && <Banner tone="info">{kindHint}</Banner>}
      {aiHint && (
        <Banner tone={aiHint.tone} onDismiss={() => setAiHint(null)}>
          {aiHint.text}
        </Banner>
      )}
      <Card padded={false}>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h3 className="text-[13.5px] font-semibold text-text">Match columns to item fields</h3>
            <p className="mt-0.5 text-[12.5px] text-text-secondary">
              {source.headers.length} columns in {source.name}. Each field can be used once; SKU is required.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="plain" icon={<RotateCcw />} onClick={() => onMappingChange(guessMapping(source.headers).mapping)}>
              Reset
            </Button>
            <Button size="sm" icon={<Sparkles />} loading={aiBusy} onClick={mapWithAi}>
              Map with AI
            </Button>
          </div>
        </div>
        <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_220px] gap-3 bg-surface-subdued px-4 py-2 text-[12px] font-medium text-text-secondary md:grid">
          <div>Source column</div>
          <div>Example value</div>
          <div>Import as</div>
        </div>
        <ul>
          {source.headers.map((h) => {
            const target = mapping[h] ?? "ignore";
            return (
              <li key={h} className="grid grid-cols-1 gap-2 border-t border-border px-4 py-2.5 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_220px] md:items-center md:gap-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-[12.5px] text-text">{h}</div>
                </div>
                <div className="min-w-0 truncate text-[12.5px] text-text-secondary">{samples[h] || <span className="text-text-tertiary">—</span>}</div>
                <Select
                  aria-label={`Import ${h} as`}
                  value={target}
                  options={TARGET_OPTIONS}
                  onChange={(e) => onMappingChange(setMappingTarget(mapping, h, e.target.value as MappingTarget))}
                  className={cn(target === "ignore" && "text-text-tertiary")}
                />
              </li>
            );
          })}
        </ul>
      </Card>

      {!skuMapped && (
        <Banner tone="critical" title="Map a column to SKU to continue">
          Items are matched by SKU. Choose the column that holds your part numbers.
        </Banner>
      )}
      {skuMapped && !nameMapped && (
        <Banner tone="warning" title="No column is mapped to Name">
          Existing items will update fine, but rows for SKUs that are not in the workspace yet need a name and will be skipped.
        </Banner>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div>
            <h3 className="text-[13.5px] font-semibold text-text">Preview</h3>
            <p className="mt-0.5 text-[12.5px] text-text-secondary">First {preview.length} rows using the current mapping.</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {mappedFields.map((f) => (
              <Badge key={f} tone="accent">
                {FIELD_LABELS[f]}
              </Badge>
            ))}
          </div>
        </div>
        <div className="px-4 pb-4">
          {mappedFields.length === 0 ? (
            <div className="rounded-[var(--radius)] border border-dashed border-border px-4 py-8 text-center text-[13px] text-text-tertiary">Nothing mapped yet.</div>
          ) : (
            <SimpleTable>
              <thead>
                <tr>
                  <th className="w-10">#</th>
                  {mappedFields.map((f) => (
                    <th key={f}>{FIELD_LABELS[f]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i}>
                    <td className="text-text-tertiary tabular">{i + 1}</td>
                    {mappedFields.map((f: TargetField) => (
                      <td key={f} className="max-w-[220px] truncate">
                        {row[cols[f] ?? ""] || <span className="text-text-tertiary">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </SimpleTable>
          )}
        </div>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <Button icon={<ArrowLeft />} onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" iconRight={<ArrowRight />} onClick={onContinue} disabled={!skuMapped}>
          Continue to review
        </Button>
      </div>
    </div>
  );
}
