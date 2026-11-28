"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, Download } from "lucide-react";
import { Badge, Banner, Button, Card, Segmented, Select, SimpleTable, useToast } from "@/components/ui";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { BOM_IMPORT_FIELDS, BOM_IMPORT_LABELS, BOM_IMPORT_REQUIRED, guessBomMapping, diffCount, importBoms, planBomImport, type BomDiff, type BomImportMapping, type BomImportMode, type BomLineChange } from "@/lib/bomImport";
import { formatNumber, pluralize } from "@/lib/format";
import { useItems, useStore } from "@/lib/store/provider";
import type { ParsedSource } from "../types";
import type { RecordStage } from "./RecordImport";

interface BomImportProps {
  source: ParsedSource;
  onStage: (stage: RecordStage) => void;
  onBack: () => void;
  onRestart: () => void;
}

const MODES: Array<{ value: BomImportMode; label: string }> = [
  { value: "replace", label: "Replace each parts list" },
  { value: "add", label: "Add to each parts list" },
];

/**
 * Bills of materials from a spreadsheet (feature `bomImport`): match the columns, review every
 * assembly with its line counts and any rows that cannot be used, import. Logic in src/lib/bomImport.ts.
 */
export function BomImport({ source, onStage, onBack, onRestart }: BomImportProps) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const items = useItems();
  const writable = canWrite(user);
  const [stage, setStage] = useState<RecordStage>("map");
  const [mapping, setMapping] = useState<BomImportMapping>(() => guessBomMapping(source.headers));
  const [mode, setMode] = useState<BomImportMode>("replace");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ set: number; converted: number } | null>(null);
  const notify = useRef(onStage);
  useEffect(() => {
    notify.current = onStage;
  }, [onStage]);
  useEffect(() => {
    notify.current(stage);
  }, [stage]);

  const missing = BOM_IMPORT_REQUIRED.filter((f) => !mapping[f]);
  const plan = useMemo(() => (missing.length ? null : planBomImport(source.rows, mapping, items, mode)), [missing.length, source.rows, mapping, items, mode]);
  const columnOptions = [{ value: "", label: "— not imported —" }, ...source.headers.map((h) => ({ value: h, label: h }))];
  const samples = useMemo(() => Object.fromEntries(source.headers.map((h) => [h, source.rows.find((r) => r[h])?.[h] ?? ""])), [source]);
  const lineCount = plan ? plan.boms.reduce((a, b) => a + b.bom.length, 0) : 0;
  const converting = plan ? plan.boms.filter((b) => b.becomesAssembly).length : 0;
  const changedCount = plan ? plan.boms.reduce((a, b) => a + diffCount(b.diff), 0) : 0;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const run = async () => {
    if (!writable || !plan || plan.boms.length === 0) return;
    setBusy(true);
    try {
      const r = await importBoms(store, user, plan, source.name);
      setResult(r);
      setStage("done");
      toast(`Imported parts lists for ${pluralize(r.set, "assembly", "assemblies")}`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
    } finally {
      setBusy(false);
    }
  };

  if (stage === "done" && result)
    return (
      <Card className="px-6 py-8 text-center">
        <h2 className="text-[16px] font-semibold text-text">Import complete</h2>
        <p className="mt-1 text-[13px] text-text-secondary">
          Parts lists set for {pluralize(result.set, "assembly", "assemblies")} from {source.name}
          {result.converted ? `; ${pluralize(result.converted, "part")} became assemblies` : ""}.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button variant="primary" href="/builds">
            Open BOM
          </Button>
          <Button onClick={onRestart}>Import something else</Button>
        </div>
      </Card>
    );

  if (stage === "review" && plan)
    return (
      <div className="flex flex-col gap-4">
        {!writable && (
          <Banner tone="warning" title="View-only access">
            Your role can review the file but not import it.
          </Banner>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Tile label="Assemblies" value={plan.boms.length} tone="success" />
          <Tile label="Parts list lines" value={lineCount} />
          <Tile label="Lines changed" value={changedCount} tone={changedCount ? "info" : "default"} />
          <Tile label="Parts becoming assemblies" value={converting} tone="info" />
          <Tile label="Problems" value={plan.errors.length} tone={plan.errors.length ? "critical" : "default"} />
        </div>
        {plan.errors.length > 0 && (
          <Banner tone="warning" title={`${pluralize(plan.errors.length, "problem")} in the sheet`}>
            <p className="mb-1.5">An assembly with a problem row is held back whole, so no parts list comes in half done. The rest import.</p>
            <ul className="max-h-[200px] list-disc overflow-auto pl-5">
              {plan.errors.map((e, i) => (
                <li key={i}>
                  Row {e.row}: {e.message}
                </li>
              ))}
            </ul>
          </Banner>
        )}
        <Card padded={false}>
          <div className="max-h-[480px] overflow-auto">
            <SimpleTable>
              <thead>
                <tr>
                  <th className="w-16">Row</th>
                  <th>Assembly</th>
                  <th className="w-24 text-right">Lines now</th>
                  <th className="w-24 text-right">Lines after</th>
                  <th className="w-[300px]">Change</th>
                </tr>
              </thead>
              <tbody>
                {plan.boms.map((b) => {
                  const open = expanded.has(b.assembly.id);
                  const toggle = () => setExpanded((s) => (s.has(b.assembly.id) ? new Set([...s].filter((x) => x !== b.assembly.id)) : new Set([...s, b.assembly.id])));
                  const Chevron = open ? ChevronDown : ChevronRight;
                  return (
                    <Fragment key={b.assembly.id}>
                      <tr className="cursor-pointer hover:bg-surface-hover" onClick={toggle} aria-expanded={open}>
                        <td className="tabular text-text-tertiary">{b.row}</td>
                        <td>
                          <span className="inline-flex items-center gap-1">
                            <Chevron className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                            <span className="font-mono text-[12px] text-text">{b.assembly.sku}</span>
                          </span>
                          <span className="ml-2 text-text-secondary">{b.assembly.name}</span>
                        </td>
                        <td className="tabular text-right text-text-secondary">{b.linesBefore}</td>
                        <td className="tabular text-right text-text">{b.bom.length}</td>
                        <td>
                          <span className="flex flex-wrap gap-1">
                            {b.linesBefore === 0 ? <Badge tone="success">New list</Badge> : diffCount(b.diff) === 0 ? <Badge>No change</Badge> : <Badge tone="attention">{`${b.diff.changed.length} changed · ${b.diff.added.length} added · ${b.diff.removed.length} removed`}</Badge>}
                            {b.becomesAssembly && <Badge tone="info">Becomes assembly</Badge>}
                          </span>
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td />
                          <td colSpan={4} className="pb-3">
                            <BomDiffList diff={b.diff} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </SimpleTable>
          </div>
          {plan.boms.length === 0 && <p className="px-4 py-3 text-[13px] text-text-secondary">No assembly in the sheet can be imported as it stands.</p>}
        </Card>
        <div className="flex items-center justify-between gap-2">
          <Button icon={<ArrowLeft />} onClick={() => setStage("map")} disabled={busy}>
            Back
          </Button>
          <Button variant="primary" icon={<Download />} onClick={() => void run()} loading={busy} disabled={!writable || plan.boms.length === 0}>
            Import {pluralize(plan.boms.length, "parts list")}
          </Button>
        </div>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <Card padded={false}>
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-[13.5px] font-semibold text-text">Match columns to parts list fields</h3>
          <p className="mt-0.5 text-[12.5px] text-text-secondary">
            One row per component. A blank assembly cell repeats the one above. Both part numbers must already be in inventory; import items first if they are not.
          </p>
        </div>
        <ul>
          {BOM_IMPORT_FIELDS.map((f) => (
            <li key={f} className="grid grid-cols-1 gap-2 border-t border-border px-4 py-2.5 first:border-t-0 md:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-3">
              <div className="text-[13px] font-medium text-text">
                {BOM_IMPORT_LABELS[f]}
                {BOM_IMPORT_REQUIRED.includes(f) && <span className="ml-1 text-text-tertiary">required</span>}
              </div>
              <Select aria-label={`Column for ${BOM_IMPORT_LABELS[f]}`} value={mapping[f] ?? ""} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value || undefined }))} options={columnOptions} />
              <div className="truncate text-[12.5px] text-text-secondary">{mapping[f] ? samples[mapping[f]!] || <span className="text-text-tertiary">—</span> : <span className="text-text-tertiary">—</span>}</div>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 border-t border-border px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[13px] font-medium text-text">Assemblies that already have parts</div>
            <p className="text-[12.5px] text-text-secondary">{mode === "replace" ? "The sheet's list becomes the whole parts list." : "The sheet's lines are added; a component already on the list takes the sheet's quantity."}</p>
          </div>
          <Segmented value={mode} onChange={setMode} options={MODES} />
        </div>
      </Card>
      {missing.length > 0 && (
        <Banner tone="critical" title="Map the required columns">
          {missing.map((f) => BOM_IMPORT_LABELS[f]).join(", ")} {missing.length === 1 ? "is" : "are"} needed to read the sheet.
        </Banner>
      )}
      <div className="flex items-center justify-between gap-2">
        <Button icon={<ArrowLeft />} onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" iconRight={<ArrowRight />} onClick={() => setStage("review")} disabled={!plan || source.rows.length === 0}>
          Review {pluralize(source.rows.length, "row")}
        </Button>
      </div>
    </div>
  );
}

/** Per component, what the import does: added, removed, quantity changed; unchanged lines as a count. */
function BomDiffList({ diff }: { diff: BomDiff }) {
  const qty = (n: number | undefined, unit: string) => (n === undefined ? "—" : `${formatNumber(n, 4)} ${unit}`);
  const rows: Array<{ key: string; tone: "success" | "critical" | "attention"; label: string; c: BomLineChange; text: string }> = [
    ...diff.changed.map((c) => ({ key: `c-${c.itemId}`, tone: "attention" as const, label: "Qty changed", c, text: `${qty(c.from, c.unit)} → ${qty(c.to, c.unit)}` })),
    ...diff.added.map((c) => ({ key: `a-${c.itemId}`, tone: "success" as const, label: "Added", c, text: qty(c.to, c.unit) })),
    ...diff.removed.map((c) => ({ key: `r-${c.itemId}`, tone: "critical" as const, label: "Removed", c, text: `was ${qty(c.from, c.unit)}` })),
  ];
  return (
    <div className="rounded-[var(--radius)] border border-border bg-surface-subdued/50 px-3 py-2 text-[12.5px]">
      {rows.length > 0 && (
        <ul className="flex flex-col gap-1">
          {rows.map((r) => (
            <li key={r.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <Badge tone={r.tone}>{r.label}</Badge>
              <span className="font-mono text-[12px] text-text">{r.c.sku}</span>
              <span className="text-text-secondary">{r.c.name}</span>
              <span className="ml-auto tabular font-medium text-text">{r.text}</span>
            </li>
          ))}
        </ul>
      )}
      <p className={rows.length ? "mt-1.5 text-text-tertiary" : "text-text-tertiary"}>{diff.unchanged === 0 && rows.length === 0 ? "No lines." : `${formatNumber(diff.unchanged)} unchanged`}</p>
    </div>
  );
}

function Tile({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "success" | "info" | "critical" }) {
  const cls = { default: "text-text", success: "text-success", info: "text-info", critical: "text-critical" }[tone];
  return (
    <div className="card px-4 py-3">
      <div className="text-[12.5px] font-medium text-text-secondary">{label}</div>
      <div className={`mt-1 text-[20px] font-semibold leading-7 tabular ${cls}`}>{value}</div>
    </div>
  );
}
