"use client";

import { useMemo } from "react";
import type { BomLine, BomSelection, Item } from "@/lib/types";
import { bomChoiceGroups, bomOptionalLines, completeBomSelection } from "@/lib/bomOptions";
import { formatQty } from "@/lib/format";
import { Checkbox, Select } from "@/components/ui";

/**
 * The open lines of a modular BOM (src/lib/bomOptions.ts): one select per
 * choice and a tick box per optional part. Shown wherever an assembly is about
 * to be built or planned; `value` may be partial, the BOM's defaults fill the gaps.
 */
export function BomOptionsPicker({ bom, value, onChange, itemsById, disabled }: { bom: BomLine[]; value: BomSelection | undefined; onChange: (next: BomSelection) => void; itemsById: Map<string, Item>; disabled?: boolean }) {
  const groups = useMemo(() => bomChoiceGroups(bom), [bom]);
  const optional = useMemo(() => bomOptionalLines(bom), [bom]);
  const sel = useMemo(() => completeBomSelection(bom, value), [bom, value]);
  if (groups.length === 0 && optional.length === 0) return null;

  const label = (line: BomLine) => {
    const item = itemsById.get(line.itemId);
    return item ? `${item.sku} · ${item.name} (${formatQty(item.onHand, item.unit)} on hand)` : line.itemId;
  };

  return (
    <div className="rounded-[var(--radius)] border border-border p-3">
      <div className="mb-2 text-[12.5px] font-medium text-text">Options for this build</div>
      <div className="flex flex-col gap-3">
        {groups.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {groups.map((g) => (
              <Select key={g.group} label={g.group} value={sel.choices?.[g.group] ?? g.defaultItemId} disabled={disabled} onChange={(e) => onChange({ ...sel, choices: { ...sel.choices, [g.group]: e.target.value } })} options={g.lines.map((l) => ({ value: l.itemId, label: `${label(l)}${l.itemId === g.defaultItemId ? " · default" : ""}` }))} />
            ))}
          </div>
        )}
        {optional.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {optional.map((l) => {
              const item = itemsById.get(l.itemId);
              const on = sel.optional?.includes(l.itemId) ?? false;
              return (
                <Checkbox
                  key={l.itemId}
                  label={
                    <>
                      Include <span className="font-mono text-[12px]">{item?.sku ?? l.itemId}</span> {item?.name}
                    </>
                  }
                  help={item ? `${formatQty(l.qty, item.unit)} per unit · ${formatQty(item.onHand, item.unit)} on hand` : undefined}
                  checked={on}
                  disabled={disabled}
                  onChange={(v) => onChange({ ...sel, optional: v ? [...(sel.optional ?? []), l.itemId] : (sel.optional ?? []).filter((id) => id !== l.itemId) })}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
