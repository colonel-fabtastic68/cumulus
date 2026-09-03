"use client";

import { useMemo, useState } from "react";
import type { Item, ItemStatus } from "@/lib/types";
import { bulkPatchItems, type ItemPatch } from "@/lib/inventory";
import { useCollection, useItems, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { formatPercent, pluralize } from "@/lib/format";
import { round } from "@/lib/utils";
import { Button, FormGrid, Modal, Select, TextField, useToast } from "@/components/ui";

export interface BulkEditValues {
  category: string;
  status: "" | ItemStatus;
  supplierId: string;
  location: string;
  minQty: string;
  maxQty: string;
  leadTimeDays: string;
  addTags: string;
  removeTags: string;
  pricePct: string;
  costPct: string;
}

const EMPTY: BulkEditValues = {
  category: "",
  status: "",
  supplierId: "",
  location: "",
  minQty: "",
  maxQty: "",
  leadTimeDays: "",
  addTags: "",
  removeTags: "",
  pricePct: "",
  costPct: "",
};

const num = (s: string): number | undefined => (s.trim() === "" ? undefined : Number(s));
const parseTags = (s: string): string[] => Array.from(new Set(s.split(",").map((t) => t.trim()).filter(Boolean)));
const sameTags = (a: string[], b: string[]) => a.length === b.length && a.every((t, i) => t === b[i]);

export interface BulkEditPlan {
  patches: Array<{ id: string; patch: ItemPatch }>;
  /** Human-readable list of what will change, for the preview. */
  changes: string[];
  errors: string[];
}

/** Turn the form values into per-item patches. Only filled-in fields are applied. */
export function planBulkEdit(items: Item[], v: BulkEditValues, supplierName?: (id: string) => string | undefined): BulkEditPlan {
  const shared: ItemPatch = {};
  const changes: string[] = [];
  const errors: string[] = [];

  if (v.category.trim()) {
    shared.category = v.category.trim();
    changes.push(`Category → ${shared.category}`);
  }
  if (v.status) {
    shared.status = v.status;
    changes.push(`Status → ${v.status}`);
  }
  if (v.supplierId) {
    shared.supplierId = v.supplierId;
    changes.push(`Supplier → ${supplierName?.(v.supplierId) ?? v.supplierId}`);
  }
  if (v.location.trim()) {
    shared.location = v.location.trim();
    changes.push(`Location → ${shared.location}`);
  }
  const minQty = num(v.minQty);
  if (minQty !== undefined) {
    if (!Number.isFinite(minQty) || minQty < 0) errors.push("Min qty must be a non-negative number");
    else {
      shared.minQty = minQty;
      changes.push(`Min qty → ${minQty}`);
    }
  }
  const maxQty = num(v.maxQty);
  if (maxQty !== undefined) {
    if (!Number.isFinite(maxQty) || maxQty < 0) errors.push("Max qty must be a non-negative number");
    else {
      shared.maxQty = maxQty;
      changes.push(`Max qty → ${maxQty}`);
    }
  }
  if (minQty !== undefined && maxQty !== undefined && maxQty < minQty) errors.push("Max qty must be at least the min qty");
  const leadTimeDays = num(v.leadTimeDays);
  if (leadTimeDays !== undefined) {
    if (!Number.isFinite(leadTimeDays) || leadTimeDays < 0) errors.push("Lead time must be a non-negative number of days");
    else {
      shared.leadTimeDays = leadTimeDays;
      changes.push(`Lead time → ${leadTimeDays} days`);
    }
  }

  const addTags = parseTags(v.addTags);
  const removeTags = parseTags(v.removeTags);
  if (addTags.length) changes.push(`Add tags: ${addTags.join(", ")}`);
  if (removeTags.length) changes.push(`Remove tags: ${removeTags.join(", ")}`);

  const pricePct = num(v.pricePct);
  if (pricePct !== undefined) {
    if (!Number.isFinite(pricePct) || pricePct <= -100) errors.push("Price adjustment must be a percentage above -100");
    else if (pricePct !== 0) changes.push(`Price ${pricePct > 0 ? "+" : ""}${formatPercent(pricePct, 1)}`);
  }
  const costPct = num(v.costPct);
  if (costPct !== undefined) {
    if (!Number.isFinite(costPct) || costPct <= -100) errors.push("Cost adjustment must be a percentage above -100");
    else if (costPct !== 0) changes.push(`Unit cost ${costPct > 0 ? "+" : ""}${formatPercent(costPct, 1)}`);
  }

  const patches: BulkEditPlan["patches"] = [];
  if (errors.length) return { patches, changes, errors };

  const removeSet = new Set(removeTags.map((t) => t.toLowerCase()));
  for (const item of items) {
    const patch: ItemPatch = { ...shared };
    if (addTags.length || removeTags.length) {
      const kept = item.tags.filter((t) => !removeSet.has(t.toLowerCase()));
      const existing = new Set(kept.map((t) => t.toLowerCase()));
      const next = [...kept, ...addTags.filter((t) => !existing.has(t.toLowerCase()))];
      if (!sameTags(next, item.tags)) patch.tags = next;
    }
    if (pricePct !== undefined && pricePct !== 0) patch.price = round(item.price * (1 + pricePct / 100));
    if (costPct !== undefined && costPct !== 0) patch.unitCost = round(item.unitCost * (1 + costPct / 100));
    if (Object.keys(patch).length > 0) patches.push({ id: item.id, patch });
  }
  return { patches, changes, errors };
}

interface BulkEditModalProps {
  open: boolean;
  onClose: () => void;
  /** The items to edit (typically the current selection). */
  items: Item[];
  onDone?: (count: number) => void;
}

/** Edit several fields on many items at once. Mounts the form only while open so state resets on each opening. */
export function BulkEditModal(props: BulkEditModalProps) {
  if (!props.open) return null;
  return <BulkEditForm {...props} />;
}

function BulkEditForm({ open, onClose, items, onDone }: BulkEditModalProps) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const allItems = useItems();
  const suppliers = useCollection("suppliers");
  const [v, setV] = useState<BulkEditValues>(EMPTY);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = useMemo(() => Array.from(new Set(allItems.map((i) => i.category).filter((c): c is string => !!c))).sort(), [allItems]);
  const supplierById = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const plan = useMemo(() => planBulkEdit(items, v, (id) => supplierById.get(id)), [items, v, supplierById]);
  const set = (k: keyof BulkEditValues) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));

  const submit = async () => {
    if (plan.errors.length) return setError(plan.errors[0]!);
    if (plan.patches.length === 0) return setError("Fill in at least one field to change");
    setBusy(true);
    setError(null);
    try {
      const n = await bulkPatchItems(store, user, plan.patches, reason.trim() || "Bulk edit");
      toast(`Updated ${pluralize(n, "item")}`, "success");
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

  const unchanged = items.length - plan.patches.length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit ${pluralize(items.length, "item")}`}
      subtitle="Only the fields you fill in are applied. Everything else is left as it is."
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={plan.patches.length === 0 || plan.errors.length > 0}>
            Apply to {pluralize(plan.patches.length, "item")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormGrid cols={3}>
          <div>
            <TextField label="Category" value={v.category} onChange={set("category")} list="cumulus-bulk-categories" placeholder="Leave unchanged" />
            <datalist id="cumulus-bulk-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <Select
            label="Status"
            value={v.status}
            onChange={set("status")}
            placeholder="Leave unchanged"
            options={[
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" },
            ]}
            help="To supersede, open the item and choose a replacement part"
          />
          <Select label="Supplier" value={v.supplierId} onChange={set("supplierId")} placeholder="Leave unchanged" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
        </FormGrid>
        <FormGrid cols={4}>
          <TextField label="Location" value={v.location} onChange={set("location")} placeholder="Leave unchanged" />
          <TextField label="Min qty" type="number" step="any" min={0} value={v.minQty} onChange={set("minQty")} placeholder="—" />
          <TextField label="Max qty" type="number" step="any" min={0} value={v.maxQty} onChange={set("maxQty")} placeholder="—" />
          <TextField label="Lead time" suffix="days" type="number" min={0} value={v.leadTimeDays} onChange={set("leadTimeDays")} placeholder="—" />
        </FormGrid>
        <FormGrid cols={2}>
          <TextField label="Add tags" hint="comma separated" value={v.addTags} onChange={set("addTags")} placeholder="bestseller, shopify" />
          <TextField label="Remove tags" hint="comma separated" value={v.removeTags} onChange={set("removeTags")} placeholder="clearance" />
        </FormGrid>
        <FormGrid cols={2}>
          <TextField label="Adjust price by" suffix="%" type="number" step="any" value={v.pricePct} onChange={set("pricePct")} placeholder="0" help="Use a negative number to lower prices. Rounded to cents." />
          <TextField label="Adjust unit cost by" suffix="%" type="number" step="any" value={v.costPct} onChange={set("costPct")} placeholder="0" help="Applies to the standard cost, not past movements." />
        </FormGrid>
        <TextField label="Reason" hint="(shown in the activity log)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Bulk edit" />

        <div className="rounded-[var(--radius)] border border-border bg-surface-subdued px-3.5 py-3 text-[12.5px]">
          <div className="font-medium text-text">Preview</div>
          {plan.errors.length > 0 ? (
            <ul className="mt-1 list-disc pl-4 text-critical">
              {plan.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : plan.changes.length === 0 ? (
            <p className="mt-1 text-text-tertiary">Nothing to apply yet. Fill in a field above.</p>
          ) : (
            <>
              <ul className="mt-1 list-disc pl-4 text-text-secondary">
                {plan.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <p className="mt-2 text-text-secondary">
                {pluralize(plan.patches.length, "item")} will change
                {unchanged > 0 ? ` · ${pluralize(unchanged, "item")} already match and will be skipped` : ""}.
              </p>
            </>
          )}
        </div>
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>
    </Modal>
  );
}
