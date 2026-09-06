"use client";

import { useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { Badge, Banner, Card, CardHeader, SimpleTable } from "@/components/ui";
import { FIELD_LABELS, type ReviewRow, type TargetField } from "./types";

function labelFor(field: string): string {
  if (field.startsWith("custom:")) return field.slice(7);
  if (field === "status") return "Status";
  return (FIELD_LABELS as Record<string, string>)[field] ?? field;
}

/**
 * What an import would overwrite on items that already exist, so mismatches
 * between the file and the workspace are visible before anything changes.
 */
export function ImportChanges({ rows }: { rows: ReviewRow[] }) {
  const summary = useMemo(() => {
    const perField = new Map<string, number>();
    let itemsAffected = 0;
    for (const r of rows) {
      if (r.status !== "update" || r.changedFields.length === 0) continue;
      itemsAffected++;
      for (const f of r.changedFields) perField.set(f, (perField.get(f) ?? 0) + 1);
    }
    const newCustom = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r.row.attributes ?? {})) newCustom.add(k);
    return { perField: Array.from(perField.entries()).sort((a, b) => b[1] - a[1]), itemsAffected, customFields: Array.from(newCustom) };
  }, [rows]);

  if (summary.itemsAffected === 0 && summary.customFields.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="What this import changes on existing items"
        subtitle={summary.itemsAffected ? `${summary.itemsAffected} existing item${summary.itemsAffected === 1 ? "" : "s"} have values in the file that differ from the workspace.` : "No existing item values differ from the file."}
      />
      {summary.itemsAffected > 0 && (
        <Banner tone="warning" className="mb-3">
          <span className="inline-flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> The file wins: every field listed below is overwritten on those items. Uncheck nothing here; adjust the mapping (Back) if a column should be ignored.
          </span>
        </Banner>
      )}
      {summary.perField.length > 0 && (
        <SimpleTable>
          <thead>
            <tr>
              <th>Field</th>
              <th className="w-40 text-right">Items overwritten</th>
            </tr>
          </thead>
          <tbody>
            {summary.perField.map(([field, n]) => (
              <tr key={field}>
                <td>
                  {labelFor(field)}
                  {field.startsWith("custom:") && (
                    <Badge tone="attention" className="ml-2">
                      Custom field
                    </Badge>
                  )}
                </td>
                <td className="text-right tabular">{n}</td>
              </tr>
            ))}
          </tbody>
        </SimpleTable>
      )}
      {summary.customFields.length > 0 && (
        <p className="mt-3 text-[12.5px] text-text-secondary">
          Custom fields created by this import: {summary.customFields.map((c) => `“${c}”`).join(", ")}. They are stored on each item and shown on the item page; existing items that already carry a different value are counted above.
        </p>
      )}
    </Card>
  );
}

export type { TargetField };
