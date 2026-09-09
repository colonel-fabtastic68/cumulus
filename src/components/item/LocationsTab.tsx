"use client";

import { useState } from "react";
import { ArrowLeftRight, Check, MapPin } from "lucide-react";
import type { Item } from "@/lib/types";
import { setBin } from "@/lib/inventory";
import { itemBinAt, itemQtyAt, locationKindLabel, useDefaultLocation, useLocations } from "@/lib/locations";
import { useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { formatQty } from "@/lib/format";
import { Badge, Button, EmptyState, IconButton, SimpleTable, TextField, useToast } from "@/components/ui";

/** Factor 29: where this item sits, location by location, with its bin at each. */
export function LocationsTab({ item, canEdit }: { item: Item; canEdit: boolean }) {
  const locations = useLocations();
  const home = useDefaultLocation();
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const rows = locations.length ? locations : [home];
  const extra = Object.keys(item.stock ?? {}).filter((id) => !rows.some((l) => l.id === id) && (item.stock?.[id]?.qty ?? 0) !== 0);

  const save = async (locationId: string) => {
    const value = drafts[locationId];
    if (value === undefined) return;
    setSaving(locationId);
    try {
      await setBin(store, user, item.id, locationId, value);
      setDrafts((d) => {
        const next = { ...d };
        delete next[locationId];
        return next;
      });
      toast(value.trim() ? `Bin set to ${value.trim()}` : "Bin cleared", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save the bin", "critical");
    } finally {
      setSaving(null);
    }
  };

  if (rows.length === 1 && !item.inTransit && extra.length === 0) {
    const only = rows[0]!;
    const bin = itemBinAt(item, only.id, home.id);
    return (
      <div className="flex flex-col gap-3">
        <SimpleTable>
          <thead>
            <tr>
              <th>Location</th>
              <th>Bin</th>
              <th className="text-right">On hand</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <span className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-icon" /> {only.name} <Badge tone="success">Default</Badge>
                </span>
              </td>
              <td>
                <BinCell value={drafts[only.id] ?? bin ?? ""} dirty={drafts[only.id] !== undefined} canEdit={canEdit} saving={saving === only.id} onChange={(v) => setDrafts((d) => ({ ...d, [only.id]: v }))} onSave={() => void save(only.id)} />
              </td>
              <td className="text-right tabular">{formatQty(item.onHand, item.unit)}</td>
            </tr>
          </tbody>
        </SimpleTable>
        <EmptyState icon={<ArrowLeftRight />} title="One location so far" description="Add warehouses, trucks or trailers under Settings → Locations to hold this item in more than one place and transfer between them." action={<Button href="/settings">Manage locations</Button>} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <SimpleTable>
        <thead>
          <tr>
            <th>Location</th>
            <th>Kind</th>
            <th>Bin</th>
            <th className="text-right">On hand</th>
          </tr>
        </thead>
        <tbody>
          {[...rows, ...extra.map((id) => ({ id, name: id, kind: "other" as const, active: false, createdAt: "", isDefault: false }))].map((loc) => {
            const qty = itemQtyAt(item, loc.id, home.id);
            const bin = itemBinAt(item, loc.id, home.id);
            return (
              <tr key={loc.id} className={qty === 0 ? "text-text-secondary" : undefined}>
                <td>
                  <span className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-icon" /> <span className="text-text">{loc.name}</span>
                    {loc.isDefault && <Badge tone="success">Default</Badge>}
                    {!loc.active && loc.createdAt && <Badge>Inactive</Badge>}
                  </span>
                </td>
                <td>{loc.createdAt ? locationKindLabel(loc.kind) : "—"}</td>
                <td>
                  <BinCell value={drafts[loc.id] ?? bin ?? ""} dirty={drafts[loc.id] !== undefined} canEdit={canEdit} saving={saving === loc.id} onChange={(v) => setDrafts((d) => ({ ...d, [loc.id]: v }))} onSave={() => void save(loc.id)} />
                </td>
                <td className="text-right tabular">{formatQty(qty, item.unit)}</td>
              </tr>
            );
          })}
          {!!item.inTransit && item.inTransit > 0 && (
            <tr className="text-text-secondary">
              <td>
                <span className="flex items-center gap-2">
                  <ArrowLeftRight className="h-4 w-4 text-icon" /> In transit
                </span>
              </td>
              <td>Transfer</td>
              <td>—</td>
              <td className="text-right tabular">{formatQty(item.inTransit, item.unit)}</td>
            </tr>
          )}
        </tbody>
      </SimpleTable>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-text-tertiary">Total on hand {formatQty(item.onHand, item.unit)}{item.inTransit ? ` plus ${formatQty(item.inTransit, item.unit)} in transit` : ""}. Bins are free text: aisle, rack, shelf, whatever the floor uses.</p>
        {canEdit && (
          <Button size="sm" icon={<ArrowLeftRight />} href={`/transfers?sku=${encodeURIComponent(item.sku)}`}>
            Transfer
          </Button>
        )}
      </div>
    </div>
  );
}

function BinCell({ value, dirty, canEdit, saving, onChange, onSave }: { value: string; dirty: boolean; canEdit: boolean; saving: boolean; onChange: (v: string) => void; onSave: () => void }) {
  if (!canEdit) return <span className={value ? "font-mono text-[12px]" : "text-text-tertiary"}>{value || "—"}</span>;
  return (
    <span className="flex items-center gap-1">
      <TextField value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSave()} placeholder="A-01-3" aria-label="Bin" className="w-32 font-mono" containerClassName="w-32" />
      {dirty && <IconButton size="sm" variant="primary" aria-label="Save bin" icon={<Check />} loading={saving} onClick={onSave} />}
    </span>
  );
}
