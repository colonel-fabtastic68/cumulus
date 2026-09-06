"use client";

import { Boxes, CheckCircle2, Plug, RotateCcw } from "lucide-react";
import { Button, Card, CardHeader, SimpleTable, Stat } from "@/components/ui";
import { pluralize } from "@/lib/format";
import type { ImportResult } from "@/lib/inventory";

interface DoneStepProps {
  result: ImportResult;
  sourceName: string;
  attempted: number;
  onRestart: () => void;
}

export function DoneStep({ result, sourceName, attempted, onRestart }: DoneStepProps) {
  const ok = result.errors.length === 0;
  return (
    <div className="flex flex-col gap-4">
      <Card className="px-6 py-8">
        <div className="flex flex-col items-center text-center">
          <span className={`mb-4 flex h-12 w-12 items-center justify-center rounded-full ${ok ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
            <CheckCircle2 className="h-5 w-5" />
          </span>
          <h2 className="text-[16px] font-semibold text-text">{ok ? "Import complete" : "Import finished with some errors"}</h2>
          <p className="mt-1 max-w-md text-[13px] text-text-secondary">
            {pluralize(attempted, "row")} from {sourceName} processed. Quantities were recorded as import movements so the stock ledger stays the source of truth.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" icon={<Boxes />} href="/inventory">
              View inventory
            </Button>
            <Button icon={<RotateCcw />} onClick={onRestart}>
              Import another file
            </Button>
            <Button variant="plain" icon={<Plug />} href="/integrations">
              Connect Shopify or WooCommerce
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 @md:grid-cols-4">
        <Stat label="Created" value={result.created} tone={result.created ? "success" : "default"} />
        <Stat label="Updated" value={result.updated} />
        <Stat label="Skipped" value={result.skipped} tone={result.skipped ? "warning" : "default"} />
        <Stat label="Errors" value={result.errors.length} tone={result.errors.length ? "critical" : "default"} />
      </div>

      {result.errors.length > 0 && (
        <Card>
          <CardHeader title="Rows that could not be imported" subtitle="Fix these in your spreadsheet and import the file again; existing rows will simply be updated." />
          <SimpleTable>
            <thead>
              <tr>
                <th className="w-16">Row</th>
                <th>Problem</th>
              </tr>
            </thead>
            <tbody>
              {result.errors.map((e, i) => (
                <tr key={i}>
                  <td className="tabular text-text-secondary">{e.row}</td>
                  <td className="text-critical">{e.message}</td>
                </tr>
              ))}
            </tbody>
          </SimpleTable>
        </Card>
      )}
    </div>
  );
}
