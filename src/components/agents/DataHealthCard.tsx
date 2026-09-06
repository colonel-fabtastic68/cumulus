"use client";

import { useMemo } from "react";
import { CheckCircle2, Wand2 } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui";
import { useItems } from "@/lib/store/provider";
import { useAgent } from "@/components/agent/AgentProvider";
import { pluralize } from "@/lib/format";
import type { Item } from "@/lib/types";

interface HealthRow {
  key: string;
  label: string;
  hint: string;
  items: Item[];
  /** Instruction sent to Nimbus, before the SKU list is appended. */
  instruction: string;
}

const MAX_SKUS_IN_PROMPT = 25;

function buildPrompt(row: HealthRow): string {
  const skus = row.items.map((i) => i.sku);
  const shown = skus.slice(0, MAX_SKUS_IN_PROMPT);
  const rest = skus.length - shown.length;
  const list = shown.join(", ") + (rest > 0 ? ` (and ${rest} more)` : "");
  return `${row.instruction} There are ${pluralize(skus.length, "item")}: ${list}. Show me a table of proposed values before applying anything.`;
}

export function DataHealthCard() {
  const items = useItems();
  const { open } = useAgent();

  const { rows, activeCount, affectedCount } = useMemo(() => {
    const active = items.filter((i) => i.status === "active");
    const rows: HealthRow[] = [
      {
        key: "cost",
        label: "Missing unit cost",
        hint: "Valuation and margins will be wrong",
        items: active.filter((i) => !(i.unitCost > 0)),
        instruction: "Fix items with no unit cost. For each, propose a unit cost from the most recent receipt, the supplier's other parts, or similar items, and update it with the reason.",
      },
      {
        key: "price",
        label: "Missing list price",
        hint: "Cannot be sold or margin-checked",
        items: active.filter((i) => !(i.price > 0)),
        instruction: "Fix items with no list price. Propose a list price for each that keeps at least a 40% margin over unit cost (use the rolled-up BOM cost for assemblies) and is consistent with similar items.",
      },
      {
        key: "minmax",
        label: "Missing min or max",
        hint: "Low-stock alerts and reorder plans skip them",
        items: active.filter((i) => i.minQty === undefined || i.maxQty === undefined),
        instruction: "Set a minimum and maximum quantity for items that are missing one. Base each on recent consumption rate and lead time so min covers lead time plus a buffer and max covers about eight weeks.",
      },
      {
        key: "supplier",
        label: "Parts without a supplier",
        hint: "Reorder plans cannot group them",
        items: active.filter((i) => i.type === "part" && !i.supplierId),
        instruction: "Assign a supplier to parts that have none. Suggest the most likely supplier from receipts, supplier SKU patterns and similar parts in the same category, and update each item.",
      },
      {
        key: "category",
        label: "Missing category",
        hint: "Reports and filters lose them",
        items: active.filter((i) => !i.category?.trim()),
        instruction: "Assign a category to items that have none, reusing the existing category names in the workspace where they fit, and update each item.",
      },
      {
        key: "bom",
        label: "Assemblies with an empty BOM",
        hint: "Cannot be built or costed",
        items: active.filter((i) => i.type === "assembly" && i.bom.length === 0),
        instruction: "These assemblies have an empty bill of materials. Suggest a BOM for each based on similar assemblies and their names, and explain what you are unsure about.",
      },
    ];
    const affected = new Set<string>();
    for (const r of rows) for (const i of r.items) affected.add(i.id);
    return { rows, activeCount: active.length, affectedCount: affected.size };
  }, [items]);

  const clean = affectedCount === 0;

  return (
    <Card padded={false}>
      <div className="px-4 pt-4">
        <CardHeader
          title="Data health"
          subtitle={
            clean
              ? `All ${pluralize(activeCount, "active item")} have cost, price, min/max, supplier and category.`
              : `${pluralize(affectedCount, "active item")} of ${activeCount} have at least one gap.`
          }
          actions={clean ? <Badge tone="success" dot>Clean</Badge> : <Badge tone="warning" dot>{affectedCount} to fix</Badge>}
        />
      </div>
      <ul className="divide-y divide-border">
        {rows.map((row) => {
          const n = row.items.length;
          return (
            <li key={row.key} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-text">{row.label}</span>
                <span className="block text-[12px] text-text-tertiary">{row.hint}</span>
              </span>
              <span className="tabular shrink-0">
                {n === 0 ? (
                  <span className="inline-flex items-center gap-1 text-[12.5px] text-success">
                    <CheckCircle2 className="h-3.5 w-3.5" /> 0
                  </span>
                ) : (
                  <Badge tone={n > 10 ? "critical" : "warning"}>{n}</Badge>
                )}
              </span>
              <Button size="sm" variant="plain" icon={<Wand2 />} disabled={n === 0} onClick={() => open(buildPrompt(row), { send: true })} className="shrink-0">
                Fix with Nimbus
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
