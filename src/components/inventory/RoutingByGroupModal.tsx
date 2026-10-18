"use client";

import { useMemo, useState } from "react";
import type { Item } from "@/lib/types";
import { bulkPatchItems } from "@/lib/inventory";
import { useLocations } from "@/lib/locations";
import { useCollection, useItems, useSettings, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { pluralize } from "@/lib/format";
import { Button, FormGrid, Modal, Select, useToast } from "@/components/ui";
import { EMPTY_BULK_EDIT, ROUTING_CLEAR, planBulkEdit } from "./BulkEditModal";

interface Group {
  key: string;
  label: string;
  /** The grouping value an item carries, if any. */
  valueOf: (item: Item) => string | undefined;
  /** Display name for a value (supplier ids become names). */
  nameOf?: (value: string) => string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onDone?: (count: number) => void;
}

/**
 * Set where purchase orders receive and sales orders relieve every part that shares a
 * category, brand, supplier or custom field value (a product line code, say), in one go.
 */
export function RoutingByGroupModal(props: Props) {
  if (!props.open) return null;
  return <RoutingByGroupForm {...props} />;
}

function RoutingByGroupForm({ open, onClose, onDone }: Props) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const items = useItems();
  const suppliers = useCollection("suppliers");
  const settings = useSettings();
  const locations = useLocations();
  const customFields = settings.catalog?.customFields?.items;
  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const groups = useMemo<Group[]>(
    () => [
      { key: "category", label: "Category", valueOf: (i) => i.category?.trim() || undefined },
      { key: "brand", label: "Brand", valueOf: (i) => i.brand?.trim() || undefined },
      { key: "supplier", label: "Supplier", valueOf: (i) => i.supplierId, nameOf: (id) => supplierById.get(id) ?? id },
      ...(customFields ?? []).map<Group>((f) => ({ key: `attr:${f.key}`, label: f.label, valueOf: (i) => i.attributes?.[f.key]?.trim() || undefined })),
    ],
    [customFields, supplierById],
  );
  const [groupKey, setGroupKey] = useState(groups[0]!.key);
  const [value, setValue] = useState("");
  const [receiveLocationId, setReceiveLocationId] = useState("");
  const [fulfillLocationId, setFulfillLocationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const group = groups.find((g) => g.key === groupKey) ?? groups[0]!;
  const noun = group.label.toLowerCase();
  const values = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const v = group.valueOf(item);
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([v, n]) => ({ value: v, name: group.nameOf?.(v) ?? v, count: n }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, group]);
  const matching = useMemo(() => (value ? items.filter((i) => group.valueOf(i) === value) : []), [items, group, value]);
  const locationById = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations]);
  const plan = useMemo(() => planBulkEdit(matching, { ...EMPTY_BULK_EDIT, receiveLocationId, fulfillLocationId }, undefined, (id) => locationById.get(id)), [matching, receiveLocationId, fulfillLocationId, locationById]);
  const routingOptions = useMemo(() => [{ value: ROUTING_CLEAR, label: "Clear: follow the receipt or shipment" }, ...locations.map((l) => ({ value: l.id, label: l.name }))], [locations]);
  const valueName = values.find((v) => v.value === value)?.name ?? value;
  const unchanged = matching.length - plan.patches.length;

  const pickGroup = (key: string) => {
    setGroupKey(key);
    setValue("");
  };

  const submit = async () => {
    if (!value) return setError(`Pick a ${noun} first`);
    if (!receiveLocationId && !fulfillLocationId) return setError("Choose a receive location, a fulfillment location, or both");
    if (plan.patches.length === 0) return setError("Every matching item already has this routing");
    setBusy(true);
    setError(null);
    try {
      const n = await bulkPatchItems(store, user, plan.patches, `Stock routing for ${noun} ${valueName}`);
      toast(`Routing set on ${pluralize(n, "item")} with ${noun} ${valueName}`, "success");
      onDone?.(n);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      toast(msg, "critical");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Stock routing by group"
      subtitle="Pick every part that shares a category, brand, supplier or custom field value, then say where purchase orders receive them and where sales orders relieve them."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={locations.length < 2 || plan.patches.length === 0}>
            Apply to {pluralize(plan.patches.length, "item")}
          </Button>
        </>
      }
    >
      {locations.length < 2 ? (
        <p className="text-[13px] text-text-secondary">Routing needs more than one location. Add a warehouse, store or truck under Settings → Locations first.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <FormGrid cols={2}>
            <Select label="Group by" value={groupKey} onChange={(e) => pickGroup(e.target.value)} options={groups.map((g) => ({ value: g.key, label: g.label }))} help="Custom item fields from Settings → Catalog show here too, so a product line code works." />
            <Select label={group.label} value={value} onChange={(e) => setValue(e.target.value)} placeholder={values.length ? `Choose a ${noun}` : `No item carries a ${noun} yet`} options={values.map((v) => ({ value: v.value, label: `${v.name} (${pluralize(v.count, "item")})` }))} disabled={values.length === 0} />
          </FormGrid>
          <FormGrid cols={2}>
            <Select label="Purchase orders receive into" value={receiveLocationId} onChange={(e) => setReceiveLocationId(e.target.value)} placeholder="Leave unchanged" options={routingOptions} help="Where deliveries of these parts land unless the receipt says otherwise." />
            <Select label="Sales orders relieve from" value={fulfillLocationId} onChange={(e) => setFulfillLocationId(e.target.value)} placeholder="Leave unchanged" options={routingOptions} help="Where shipments of these parts take stock from unless the shipment says otherwise." />
          </FormGrid>
          <div className="rounded-[var(--radius)] border border-border bg-surface-subdued px-3.5 py-3 text-[12.5px]">
            <div className="font-medium text-text">Preview</div>
            {!value ? (
              <p className="mt-1 text-text-tertiary">Choose a {noun} to see which items this covers.</p>
            ) : plan.changes.length === 0 ? (
              <p className="mt-1 text-text-secondary">
                {pluralize(matching.length, "item")} with {noun} <span className="font-medium text-text">{valueName}</span>. Choose a location above.
              </p>
            ) : (
              <>
                <ul className="mt-1 list-disc pl-4 text-text-secondary">
                  {plan.changes.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
                <p className="mt-2 text-text-secondary">
                  {pluralize(plan.patches.length, "item")} with {noun} <span className="font-medium text-text">{valueName}</span> will change
                  {unchanged > 0 ? ` · ${pluralize(unchanged, "item")} already match and will be skipped` : ""}.
                </p>
              </>
            )}
          </div>
          {error && <p className="text-[12.5px] text-critical">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
