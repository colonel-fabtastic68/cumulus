"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Layers, Plus, Trash2 } from "lucide-react";
import type { BomLine, Item } from "@/lib/types";
import { buildableQty, explodeBom, rolledUpCost, updateItem, whereUsedDeep } from "@/lib/inventory";
import { useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { formatMoney, formatQty } from "@/lib/format";
import { cn, round } from "@/lib/utils";
import { Badge, Button, EmptyState, IconButton, SimpleTable, TextField, Toggle, useToast } from "@/components/ui";
import { ItemPicker } from "@/components/inventory";
import { Tile } from "./Tile";
import { errorMessage, itemHref } from "./utils";

export function BomTab({ item, items, currency, canEdit }: { item: Item; items: Item[]; currency: string; canEdit: boolean }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const [converting, setConverting] = useState(false);

  if (item.type !== "assembly") {
    return (
      <EmptyState
        icon={<Layers />}
        title="This is a part"
        description="Parts are bought or made without a bill of materials. Convert it to an assembly to define the components it is built from."
        action={
          canEdit ? (
            <Button
              variant="primary"
              loading={converting}
              onClick={async () => {
                setConverting(true);
                try {
                  await updateItem(store, user, item.id, { type: "assembly" }, "Converted to assembly");
                  toast(`${item.sku} is now an assembly`, "success");
                } catch (e) {
                  toast(errorMessage(e), "critical");
                } finally {
                  setConverting(false);
                }
              }}
            >
              Convert to assembly
            </Button>
          ) : undefined
        }
      />
    );
  }

  // Remount the editor whenever the saved BOM changes (e.g. a teammate edited it).
  return <BomEditor key={JSON.stringify(item.bom)} item={item} items={items} currency={currency} canEdit={canEdit} />;
}

interface DraftLine {
  itemId: string;
  qty: string;
  wastePct: string;
}

function BomEditor({ item, items, currency, canEdit }: { item: Item; items: Item[]; currency: string; canEdit: boolean }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [draft, setDraft] = useState<DraftLine[]>(() => item.bom.map((l) => ({ itemId: l.itemId, qty: String(l.qty), wastePct: l.wastePct !== undefined ? String(l.wastePct) : "" })));
  const [saving, setSaving] = useState(false);
  const [explodeQty, setExplodeQty] = useState("10");
  const [consumeSub, setConsumeSub] = useState(true);

  const parsed = useMemo<BomLine[]>(
    () =>
      draft
        .map((d) => ({ itemId: d.itemId, qty: Number(d.qty), wastePct: d.wastePct.trim() === "" ? undefined : Number(d.wastePct) }))
        .filter((l) => byId.has(l.itemId) && Number.isFinite(l.qty) && l.qty > 0),
    [draft, byId],
  );
  const invalid = draft.some((d) => !Number.isFinite(Number(d.qty)) || Number(d.qty) <= 0 || (d.wastePct.trim() !== "" && (!Number.isFinite(Number(d.wastePct)) || Number(d.wastePct) < 0)));
  const dirty = JSON.stringify(parsed) !== JSON.stringify(item.bom.map((l) => ({ itemId: l.itemId, qty: l.qty, wastePct: l.wastePct })));

  const draftItem = useMemo(() => ({ ...item, bom: parsed }), [item, parsed]);
  const rolled = useMemo(() => rolledUpCost(items, draftItem), [items, draftItem]);
  const buildable = useMemo(() => buildableQty(items, item), [items, item]);
  const ancestors = useMemo(() => new Set(whereUsedDeep(items, item.id).map((a) => a.id)), [items, item.id]);
  const exclude = useMemo(() => [item.id, ...ancestors, ...draft.map((d) => d.itemId)], [item.id, ancestors, draft]);

  const n = Math.max(0, Number(explodeQty) || 0);
  const reqs = useMemo(() => (n > 0 ? explodeBom(items, item, n, { consumeSubassemblies: consumeSub, explodeShortfallOnly: !consumeSub }) : []), [items, item, n, consumeSub]);
  const shortages = reqs.filter((r) => r.shortage > 0);

  const save = async () => {
    if (invalid) return toast("Fix the highlighted quantities first", "critical");
    setSaving(true);
    try {
      await updateItem(store, user, item.id, { bom: parsed, type: "assembly" }, "BOM edited");
      toast(`Saved BOM for ${item.sku}`, "success");
    } catch (e) {
      toast(errorMessage(e), "critical");
    } finally {
      setSaving(false);
    }
  };

  const setCost = async () => {
    try {
      await updateItem(store, user, item.id, { unitCost: rolled }, "Unit cost set to rolled-up BOM cost");
      toast(`Unit cost set to ${formatMoney(rolled, currency)}`, "success");
    } catch (e) {
      toast(errorMessage(e), "critical");
    }
  };

  const update = (idx: number, patch: Partial<DraftLine>) => setDraft((d) => d.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Tile label="Components" value={parsed.length} hint={`${parsed.filter((l) => byId.get(l.itemId)?.type === "assembly").length} sub-assemblies`} />
        <Tile label="Rolled-up cost" value={formatMoney(rolled, currency)} hint={dirty ? "From the unsaved draft" : "Recursive across sub-assemblies"} />
        <Tile
          label="Standard cost"
          value={formatMoney(item.unitCost, currency)}
          hint={Math.abs(item.unitCost - rolled) > 0.005 ? `${item.unitCost > rolled ? "+" : "−"}${formatMoney(Math.abs(item.unitCost - rolled), currency)} vs rolled-up` : "Matches rolled-up"}
          tone={Math.abs(item.unitCost - rolled) > 0.005 ? "warning" : "default"}
        />
        <Tile label="Buildable now" value={formatQty(buildable, item.unit)} hint="Pulling sub-assemblies from stock" tone={buildable === 0 && item.bom.length > 0 ? "critical" : "default"} />
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Bill of materials</h4>
          <div className="flex items-center gap-2">
            {canEdit && Math.abs(item.unitCost - rolled) > 0.005 && !dirty && (
              <Button size="sm" onClick={setCost}>
                Set unit cost to {formatMoney(rolled, currency)}
              </Button>
            )}
            {canEdit && dirty && (
              <>
                <Button size="sm" onClick={() => setDraft(item.bom.map((l) => ({ itemId: l.itemId, qty: String(l.qty), wastePct: l.wastePct !== undefined ? String(l.wastePct) : "" })))}>
                  Discard
                </Button>
                <Button size="sm" variant="primary" loading={saving} disabled={invalid} onClick={save}>
                  Save BOM
                </Button>
              </>
            )}
          </div>
        </div>
        <SimpleTable>
          <thead>
            <tr>
              <th>Component</th>
              <th className="w-28 text-right">Qty per</th>
              <th className="w-24 text-right">Waste %</th>
              <th className="text-right">On hand</th>
              <th className="text-right">Unit cost</th>
              <th className="text-right">Extended</th>
              {canEdit && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {draft.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 7 : 6} className="py-6 text-center text-text-tertiary">
                  No components yet. Add the parts and sub-assemblies this item is built from.
                </td>
              </tr>
            )}
            {draft.map((d, idx) => {
              const comp = byId.get(d.itemId);
              if (!comp) return null;
              const qty = Number(d.qty);
              const waste = d.wastePct.trim() === "" ? (comp.expectedWastePct ?? 0) : Number(d.wastePct);
              const compCost = comp.type === "assembly" ? rolledUpCost(items, comp) : comp.unitCost;
              const ext = Number.isFinite(qty) ? round(qty * (1 + (Number.isFinite(waste) ? waste : 0) / 100) * compCost) : 0;
              const badQty = !Number.isFinite(qty) || qty <= 0;
              return (
                <tr key={d.itemId}>
                  <td>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link href={itemHref(comp.id)} className="font-mono text-[12px] font-medium text-text hover:text-accent">
                        {comp.sku}
                      </Link>
                      <span className="text-text-secondary">{comp.name}</span>
                      {comp.type === "assembly" && <Badge tone="info">Sub-assembly</Badge>}
                      {comp.status !== "active" && <Badge tone={comp.status === "superseded" ? "warning" : "default"}>{comp.status}</Badge>}
                    </div>
                  </td>
                  <td className="text-right">
                    {canEdit ? (
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={d.qty}
                        onChange={(e) => update(idx, { qty: e.target.value })}
                        aria-label={`Quantity of ${comp.sku}`}
                        className={cn("h-7 w-24 rounded-[var(--radius-sm)] border bg-surface px-2 text-right text-[13px] tabular outline-none focus:border-accent focus:ring-2 focus:ring-accent/20", badQty ? "border-critical" : "border-border-strong/70")}
                      />
                    ) : (
                      formatQty(qty, comp.unit)
                    )}
                  </td>
                  <td className="text-right">
                    {canEdit ? (
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={d.wastePct}
                        placeholder={comp.expectedWastePct !== undefined ? String(comp.expectedWastePct) : "0"}
                        onChange={(e) => update(idx, { wastePct: e.target.value })}
                        aria-label={`Waste percent for ${comp.sku}`}
                        className="h-7 w-20 rounded-[var(--radius-sm)] border border-border-strong/70 bg-surface px-2 text-right text-[13px] tabular outline-none placeholder:text-text-tertiary focus:border-accent focus:ring-2 focus:ring-accent/20"
                      />
                    ) : (
                      `${waste}%`
                    )}
                  </td>
                  <td className={cn("text-right tabular", comp.onHand < qty && "text-critical")}>{formatQty(comp.onHand, comp.unit)}</td>
                  <td className="text-right tabular">{formatMoney(compCost, currency)}</td>
                  <td className="text-right tabular">{formatMoney(ext, currency)}</td>
                  {canEdit && (
                    <td className="text-right">
                      <IconButton variant="plain" size="sm" onClick={() => setDraft((x) => x.filter((_, i) => i !== idx))} className="text-text-tertiary hover:text-critical" aria-label={`Remove ${comp.sku}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </td>
                  )}
                </tr>
              );
            })}
            {draft.length > 0 && (
              <tr className="bg-surface-subdued">
                <td colSpan={5} className="text-right font-medium">
                  Rolled-up cost per unit
                </td>
                <td className="text-right font-medium tabular">{formatMoney(rolled, currency)}</td>
                {canEdit && <td />}
              </tr>
            )}
          </tbody>
        </SimpleTable>
        {canEdit && (
          <div className="mt-2 flex items-center gap-2">
            <ItemPicker
              className="w-full max-w-md"
              placeholder="Add a component by SKU or name"
              value={null}
              exclude={exclude}
              filter={(i) => i.status === "active"}
              onChange={(comp) => {
                if (comp) setDraft((d) => [...d, { itemId: comp.id, qty: "1", wastePct: "" }]);
              }}
            />
            <span className="inline-flex items-center gap-1 text-[12px] text-text-tertiary">
              <Plus className="h-3.5 w-3.5" /> Ancestors are excluded to prevent loops
            </span>
          </div>
        )}
      </div>

      {item.bom.length > 0 && (
        <div>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h4 className="text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Explode requirements</h4>
              <p className="mt-0.5 text-[12.5px] text-text-secondary">What it takes to build a quantity, through every level of the BOM.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <TextField type="number" min={1} step={1} value={explodeQty} onChange={(e) => setExplodeQty(e.target.value)} prefix="×" containerClassName="w-28" aria-label="Quantity to explode" />
              <Toggle label="Pull sub-assemblies from stock" checked={consumeSub} onChange={setConsumeSub} />
            </div>
          </div>
          {n > 0 && (
            <>
              <div className="mb-1.5 text-[12.5px]">
                {shortages.length > 0 ? (
                  <span className="inline-flex items-center gap-1 text-critical">
                    <AlertTriangle className="h-3.5 w-3.5" /> Short on {shortages.length} component{shortages.length === 1 ? "" : "s"} for {n} unit{n === 1 ? "" : "s"}
                  </span>
                ) : (
                  <span className="text-success">Everything for {n} unit{n === 1 ? "" : "s"} is on the shelf</span>
                )}
              </div>
              <SimpleTable>
                <thead>
                  <tr>
                    <th>Component</th>
                    <th className="text-right">Required</th>
                    <th className="text-right">Available</th>
                    <th className="text-right">Shortage</th>
                  </tr>
                </thead>
                <tbody>
                  {reqs.map((r) => (
                    <tr key={r.item.id} className={cn(r.shortage > 0 && "bg-critical-soft/50")}>
                      <td>
                        <div className="flex items-center gap-1.5" style={{ paddingLeft: r.depth * 16 }}>
                          {r.depth > 0 && <span className="text-text-tertiary">↳</span>}
                          <Link href={itemHref(r.item.id)} className="font-mono text-[12px] text-text hover:text-accent">
                            {r.item.sku}
                          </Link>
                          <span className="text-text-secondary">{r.item.name}</span>
                        </div>
                      </td>
                      <td className="text-right tabular">{formatQty(r.required, r.item.unit)}</td>
                      <td className="text-right tabular">{formatQty(r.available, r.item.unit)}</td>
                      <td className={cn("text-right tabular", r.shortage > 0 ? "font-medium text-critical" : "text-text-tertiary")}>{r.shortage > 0 ? formatQty(r.shortage, r.item.unit) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </SimpleTable>
            </>
          )}
        </div>
      )}
    </div>
  );
}
