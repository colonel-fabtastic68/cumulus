"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Shirt, Trash2 } from "lucide-react";
import type { Item, VariantAxis } from "@/lib/types";
import { cleanAxes, isVariantParent, itemFamily, planVariants, saveVariants, variantLabel } from "@/lib/variants";
import { useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { formatMoney, formatQty, pluralize } from "@/lib/format";
import { Badge, Button, EmptyState, IconButton, SimpleTable, StatusBadge, TextField, useToast } from "@/components/ui";
import { Tile } from "./Tile";
import { errorMessage, itemHref } from "./utils";

interface DraftAxis {
  key: number;
  name: string;
  /** Comma-separated values as typed. */
  values: string;
}

const toAxes = (draft: DraftAxis[]): VariantAxis[] => cleanAxes(draft.map((d) => ({ name: d.name, values: d.values.split(",") })));

/**
 * Variants of an item (feature "variants"): list the options, and every
 * combination becomes its own stock-keeping item underneath, numbered
 * automatically. A variant shows which one it is and links back to its parent.
 */
export function VariantsTab({ item, items, currency, canEdit }: { item: Item; items: Item[]; currency: string; canEdit: boolean }) {
  // Remount the editor when the stored options change (a save, a teammate's edit).
  return <VariantsEditor key={JSON.stringify(item.variantAxes ?? [])} item={item} items={items} currency={currency} canEdit={canEdit} />;
}

function VariantsEditor({ item, items, currency, canEdit }: { item: Item; items: Item[]; currency: string; canEdit: boolean }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const [draft, setDraft] = useState<DraftAxis[]>(() => (item.variantAxes ?? []).map((a, i) => ({ key: i, name: a.name, values: a.values.join(", ") })));
  const [nextKey, setNextKey] = useState(item.variantAxes?.length ?? 0);
  const [saving, setSaving] = useState(false);

  const axes = useMemo(() => toAxes(draft), [draft]);
  const plan = useMemo(() => (axes.length ? planVariants(item, axes, items) : []), [item, axes, items]);
  const family = useMemo(() => itemFamily(item, items), [item, items]);
  const fresh = plan.filter((p) => !p.existing);
  const dirty = JSON.stringify(axes) !== JSON.stringify(item.variantAxes ?? []);
  const parent = item.variantOf ? items.find((i) => i.id === item.variantOf) : undefined;

  if (item.variantOf) {
    return (
      <EmptyState
        icon={<Shirt />}
        title={`This is the ${variantLabel(item.variantOptions, parent?.variantAxes) || "variant"} of ${parent?.sku ?? "another item"}`}
        description="Options are managed on the parent item. This variant keeps its own stock, cost history and batches."
        action={parent ? <Button href={itemHref(parent.id)}>Open {parent.sku}</Button> : undefined}
      />
    );
  }

  const addAxis = (name = "") => {
    setDraft((d) => [...d, { key: nextKey, name, values: "" }]);
    setNextKey((k) => k + 1);
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await saveVariants(store, user, item.id, axes);
      toast(res.created.length ? `Created ${pluralize(res.created.length, "variant")} of ${item.sku}` : `Saved the options for ${item.sku}`, "success");
      if (res.orphaned.length) toast(`${pluralize(res.orphaned.length, "variant")} no longer match an option and were left as they are`);
    } catch (e) {
      toast(errorMessage(e), "critical");
    } finally {
      setSaving(false);
    }
  };

  if (!isVariantParent(item) && draft.length === 0) {
    return (
      <EmptyState
        icon={<Shirt />}
        title="No variants"
        description="For a product that comes in sizes, colors or finishes: list the options once and every combination gets its own stock count, without making each one by hand."
        action={
          canEdit ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button variant="primary" icon={<Plus />} onClick={() => addAxis("Size")}>
                Add an option
              </Button>
            </div>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {isVariantParent(item) && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 @md:grid-cols-4">
          <Tile label="Variants" value={family.variants.length} hint={axes.map((a) => a.name).join(" × ") || "No options"} />
          <Tile label="On hand, all variants" value={formatQty(family.onHand, item.unit)} />
          <Tile label="Value" value={formatMoney(family.value, currency)} hint="At each variant's cost" />
          <Tile label="Out of stock" value={family.variants.filter((v) => v.status === "active" && v.onHand <= 0).length} hint="Active variants at zero" tone={family.variants.some((v) => v.status === "active" && v.onHand <= 0) ? "warning" : "default"} />
        </div>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Options</h4>
            <p className="mt-0.5 text-[12.5px] text-text-secondary">Values separated by commas. Every combination becomes a variant.</p>
          </div>
          {canEdit && (
            <div className="flex items-center gap-2">
              <Button size="sm" icon={<Plus />} onClick={() => addAxis()} disabled={draft.length >= 3}>
                Add option
              </Button>
              {dirty && (
                <>
                  <Button size="sm" onClick={() => setDraft((item.variantAxes ?? []).map((a, i) => ({ key: i, name: a.name, values: a.values.join(", ") })))}>
                    Discard
                  </Button>
                  <Button size="sm" variant="primary" loading={saving} disabled={axes.length === 0 || plan.length > 200} onClick={() => void save()}>
                    {fresh.length ? `Save and create ${pluralize(fresh.length, "variant")}` : "Save options"}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {draft.map((d) => (
            <div key={d.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_minmax(0,1fr)_32px] sm:items-start">
              <TextField aria-label="Option name" value={d.name} onChange={(e) => setDraft((cur) => cur.map((x) => (x.key === d.key ? { ...x, name: e.target.value } : x)))} placeholder="Size" disabled={!canEdit} />
              <TextField aria-label={`Values for ${d.name || "this option"}`} value={d.values} onChange={(e) => setDraft((cur) => cur.map((x) => (x.key === d.key ? { ...x, values: e.target.value } : x)))} placeholder="S, M, L, XL" disabled={!canEdit} />
              {canEdit && (
                <IconButton variant="plain" size="md" onClick={() => setDraft((cur) => cur.filter((x) => x.key !== d.key))} aria-label={`Remove ${d.name || "this option"}`} className="text-text-tertiary hover:text-critical">
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              )}
            </div>
          ))}
        </div>
        {plan.length > 200 && <p className="mt-2 text-[12.5px] text-critical">These options make {plan.length} variants; the limit is 200.</p>}
        {dirty && item.onHand !== 0 && family.variants.length === 0 && <p className="mt-2 text-[12.5px] text-warning">{item.sku} has {formatQty(item.onHand, item.unit)} on hand. Stock lives on the variants, so adjust it to zero before creating them.</p>}
      </div>

      {plan.length > 0 && (
        <div>
          <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Variants</h4>
          <SimpleTable>
            <thead>
              <tr>
                <th>Variant</th>
                <th>Code</th>
                <th className="text-right">On hand</th>
                <th className="text-right">Price</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {plan.map((p) => (
                <tr key={p.sku}>
                  <td className="font-medium text-text">{variantLabel(p.options, axes)}</td>
                  <td>
                    {p.existing ? (
                      <Link href={itemHref(p.existing.id)} className="font-mono text-[12px] text-accent hover:underline">
                        {p.existing.sku}
                      </Link>
                    ) : (
                      <span className="font-mono text-[12px] text-text-secondary">{p.sku}</span>
                    )}
                  </td>
                  <td className="text-right tabular">{p.existing ? formatQty(p.existing.onHand, p.existing.unit) : "—"}</td>
                  <td className="text-right tabular">{formatMoney(p.existing?.price ?? item.price, currency)}</td>
                  <td>{p.existing ? <StatusBadge status={p.existing.status} /> : <Badge tone="attention">New on save</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </SimpleTable>
          <p className="mt-1.5 text-[12px] text-text-tertiary">New variants take this item&apos;s price, cost, supplier, category and units. Each then has its own stock, and its details can be changed on its own page.</p>
        </div>
      )}
    </div>
  );
}
