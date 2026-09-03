"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Item, PriceBreak } from "@/lib/types";
import { marginPct, priceForQty, updateItem } from "@/lib/inventory";
import { useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { formatMoney, formatPercent } from "@/lib/format";
import { cn, round } from "@/lib/utils";
import { Badge, Button, IconButton, SimpleTable, TextField, useToast } from "@/components/ui";
import { Tile } from "./Tile";
import { errorMessage } from "./utils";

export function PricingTab({ item, currency, canEdit }: { item: Item; currency: string; canEdit: boolean }) {
  return <PricingEditor key={JSON.stringify(item.priceBreaks ?? [])} item={item} currency={currency} canEdit={canEdit} />;
}

interface DraftBreak {
  minQty: string;
  price: string;
}

function PricingEditor({ item, currency, canEdit }: { item: Item; currency: string; canEdit: boolean }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const [draft, setDraft] = useState<DraftBreak[]>(() => (item.priceBreaks ?? []).map((b) => ({ minQty: String(b.minQty), price: String(b.price) })));
  const [saving, setSaving] = useState(false);
  const [quoteQty, setQuoteQty] = useState("10");

  const parsed = useMemo<PriceBreak[]>(
    () =>
      draft
        .map((d) => ({ minQty: Number(d.minQty), price: Number(d.price) }))
        .filter((b) => Number.isFinite(b.minQty) && b.minQty > 0 && Number.isFinite(b.price) && b.price >= 0)
        .sort((a, b) => a.minQty - b.minQty),
    [draft],
  );
  const invalid = draft.some((d) => !Number.isFinite(Number(d.minQty)) || Number(d.minQty) <= 0 || !Number.isFinite(Number(d.price)) || Number(d.price) < 0);
  const dirty = JSON.stringify(parsed) !== JSON.stringify([...(item.priceBreaks ?? [])].sort((a, b) => a.minQty - b.minQty));

  const onSale = item.salePrice !== undefined && item.salePrice < item.price;
  const marginTone = (m: number) => (m < 0 ? "critical" : m < 20 ? "warning" : "default");

  const q = Math.max(1, Math.floor(Number(quoteQty) || 1));
  const quotePrice = priceForQty(item, q);

  const save = async () => {
    if (invalid) return toast("Fix the highlighted rows first", "critical");
    setSaving(true);
    try {
      await updateItem(store, user, item.id, { priceBreaks: parsed.length ? parsed : undefined }, "Price breaks edited");
      toast(`Saved price breaks for ${item.sku}`, "success");
    } catch (e) {
      toast(errorMessage(e), "critical");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">
        <Tile label="List price" value={formatMoney(item.price, currency)} hint={item.price > 0 ? `${formatPercent(marginPct(item), 1)} margin` : "No price set"} tone={item.price > 0 ? marginTone(marginPct(item)) : "default"} />
        <Tile
          label="Sale price"
          value={item.salePrice !== undefined ? formatMoney(item.salePrice, currency) : "—"}
          hint={item.salePrice !== undefined ? `${formatPercent(marginPct(item, item.salePrice), 1)} margin${onSale ? "" : " · not below list"}` : "Set one in Edit"}
          tone={item.salePrice !== undefined ? marginTone(marginPct(item, item.salePrice)) : "default"}
        />
        <Tile label="Unit cost" value={formatMoney(item.unitCost, currency)} hint={item.type === "assembly" ? "Rolled-up from BOM at last build" : "Standard cost"} />
        <Tile label="Gross profit / unit" value={formatMoney(round((onSale ? item.salePrice! : item.price) - item.unitCost), currency)} hint={onSale ? "At sale price" : "At list price"} tone={(onSale ? item.salePrice! : item.price) - item.unitCost < 0 ? "critical" : "default"} />
        <Tile label="Price breaks" value={parsed.length} hint={parsed.length ? `From ${parsed[0]!.minQty}+ units` : "None"} />
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Quantity price breaks</h4>
            <p className="mt-0.5 text-[12.5px] text-text-secondary">Orders automatically get the lowest eligible price for the quantity.</p>
          </div>
          {canEdit && (
            <div className="flex items-center gap-2">
              <Button size="sm" icon={<Plus />} onClick={() => setDraft((d) => [...d, { minQty: "", price: "" }])}>
                Add break
              </Button>
              {dirty && (
                <>
                  <Button size="sm" onClick={() => setDraft((item.priceBreaks ?? []).map((b) => ({ minQty: String(b.minQty), price: String(b.price) })))}>
                    Discard
                  </Button>
                  <Button size="sm" variant="primary" loading={saving} disabled={invalid} onClick={save}>
                    Save
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
        <SimpleTable>
          <thead>
            <tr>
              <th className="w-40">From quantity</th>
              <th className="w-40 text-right">Price</th>
              <th className="text-right">Discount vs list</th>
              <th className="text-right">Margin</th>
              {canEdit && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {draft.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 5 : 4} className="py-6 text-center text-text-tertiary">
                  No price breaks. Everyone pays {formatMoney(onSale ? item.salePrice! : item.price, currency)}.
                </td>
              </tr>
            )}
            {draft.map((d, idx) => {
              const minQty = Number(d.minQty);
              const price = Number(d.price);
              const bad = !Number.isFinite(minQty) || minQty <= 0 || !Number.isFinite(price) || price < 0;
              const m = Number.isFinite(price) ? marginPct(item, price) : 0;
              const disc = item.price > 0 && Number.isFinite(price) ? round((1 - price / item.price) * 100, 1) : 0;
              return (
                <tr key={idx}>
                  <td>
                    {canEdit ? (
                      <input type="number" min={1} step={1} value={d.minQty} onChange={(e) => setDraft((x) => x.map((r, i) => (i === idx ? { ...r, minQty: e.target.value } : r)))} aria-label="Minimum quantity" className={cn("h-7 w-28 rounded-[var(--radius-sm)] border bg-surface px-2 text-[13px] tabular outline-none focus:border-accent focus:ring-2 focus:ring-accent/20", bad ? "border-critical" : "border-border-strong/70")} />
                    ) : (
                      `${minQty}+`
                    )}
                  </td>
                  <td className="text-right">
                    {canEdit ? (
                      <input type="number" min={0} step="any" value={d.price} onChange={(e) => setDraft((x) => x.map((r, i) => (i === idx ? { ...r, price: e.target.value } : r)))} aria-label="Price" className={cn("h-7 w-28 rounded-[var(--radius-sm)] border bg-surface px-2 text-right text-[13px] tabular outline-none focus:border-accent focus:ring-2 focus:ring-accent/20", bad ? "border-critical" : "border-border-strong/70")} />
                    ) : (
                      formatMoney(price, currency)
                    )}
                  </td>
                  <td className="text-right tabular text-text-secondary">{Number.isFinite(price) && item.price > 0 ? formatPercent(disc, 1) : "—"}</td>
                  <td className="text-right">{Number.isFinite(price) && price > 0 ? <Badge tone={m < 0 ? "critical" : m < 20 ? "warning" : "success"}>{formatPercent(m, 1)}</Badge> : <span className="text-text-tertiary">—</span>}</td>
                  {canEdit && (
                    <td className="text-right">
                      <IconButton variant="plain" size="sm" onClick={() => setDraft((x) => x.filter((_, i) => i !== idx))} className="text-text-tertiary hover:text-critical" aria-label="Remove price break">
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </SimpleTable>
      </div>

      <div className="rounded-[var(--radius)] border border-border bg-surface-subdued p-4">
        <h4 className="text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">Quote calculator</h4>
        <div className="mt-2 flex flex-wrap items-end gap-4">
          <TextField label="Quantity" type="number" min={1} step={1} value={quoteQty} onChange={(e) => setQuoteQty(e.target.value)} containerClassName="w-32" />
          <div className="grid w-full grid-cols-1 gap-6 sm:w-auto sm:grid-cols-3">
            <Tile label="Unit price" value={formatMoney(quotePrice, currency)} hint={quotePrice < item.price ? `${formatPercent(round((1 - quotePrice / (item.price || 1)) * 100, 1), 1)} off list` : "List price"} />
            <Tile label="Total" value={formatMoney(round(quotePrice * q), currency)} hint={`${q} × ${formatMoney(quotePrice, currency)}`} />
            <Tile label="Margin" value={formatPercent(marginPct(item, quotePrice), 1)} hint={`${formatMoney(round((quotePrice - item.unitCost) * q), currency)} gross profit`} tone={marginTone(marginPct(item, quotePrice))} />
          </div>
        </div>
      </div>
    </div>
  );
}
