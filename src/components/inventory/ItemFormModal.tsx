"use client";

import { useMemo, useState } from "react";
import type { Item } from "@/lib/types";
import { createItems, updateItem } from "@/lib/inventory";
import { useCollection, useItems, useSettings, useStore } from "@/lib/store/provider";
import { customFieldsFor, itemTypeOptions } from "@/lib/catalog";
import { CustomFieldsEditor } from "@/components/fields";
import { useCurrentUser } from "@/lib/auth";
import { Button, Checkbox, Combobox, FormGrid, Modal, Select, TextArea, TextField, useToast } from "@/components/ui";
import { useFeatures } from "@/lib/useFeature";
import { useTerms } from "@/lib/useTerms";
import { normalizeUnit, parsePackUnit, unitOptions } from "@/lib/units";
import type { UnitConversion } from "@/lib/types";

const ASSEMBLY_COLORS = ["#1f5f8b", "#0f7b5f", "#b45309", "#8e1f0b", "#6d28d9", "#0e7490", "#475569"];

interface FormState {
  sku: string;
  name: string;
  type: Item["type"];
  color: string;
  attributes: Record<string, string>;
  category: string;
  unit: string;
  status: Item["status"];
  supplierId: string;
  supplierSku: string;
  location: string;
  barcode: string;
  unitCost: string;
  price: string;
  salePrice: string;
  minQty: string;
  maxQty: string;
  leadTimeDays: string;
  expectedWastePct: string;
  tags: string;
  description: string;
  openingQty: string;
  brand: string;
  weight: string;
  mapPrice: string;
  /** Other units as text, one per comma: "case=12, pk100=100". */
  uoms: string;
  purchaseUnit: string;
  salesUnit: string;
}

/** "case=12, pk 100" → conversions; entries that do not read as "name=number" or a pack ("pk 100") are reported. */
export function parseUoms(text: string): { uoms: UnitConversion[]; bad: string[] } {
  const uoms: UnitConversion[] = [];
  const bad: string[] = [];
  for (const part of text.split(",").map((p) => p.trim()).filter(Boolean)) {
    const m = /^([^=]+?)\s*=\s*(\d+(?:\.\d+)?)$/.exec(part);
    const parsed = m ? { unit: m[1]!.trim(), factor: Number(m[2]) } : parsePackUnit(part);
    if (!parsed || !(parsed.factor > 0) || uoms.some((u) => normalizeUnit(u.unit) === normalizeUnit(parsed.unit))) bad.push(part);
    else uoms.push(parsed);
  }
  return { uoms, bad };
}

function uomsText(uoms?: UnitConversion[]): string {
  return (uoms ?? []).map((u) => `${u.unit}=${u.factor}`).join(", ");
}

function fromItem(item?: Item | null, defaults?: Partial<Item>): FormState {
  const src = item ?? defaults;
  return {
    sku: src?.sku ?? "",
    name: src?.name ?? "",
    type: src?.type ?? "part",
    color: src?.color ?? "",
    attributes: { ...(src?.attributes ?? {}) },
    category: src?.category ?? "",
    unit: src?.unit ?? "ea",
    status: src?.status ?? "active",
    supplierId: src?.supplierId ?? "",
    supplierSku: src?.supplierSku ?? "",
    location: src?.location ?? "",
    barcode: src?.barcode ?? "",
    unitCost: src?.unitCost !== undefined ? String(src.unitCost) : "",
    price: src?.price !== undefined ? String(src.price) : "",
    salePrice: src?.salePrice !== undefined ? String(src.salePrice) : "",
    minQty: src?.minQty !== undefined ? String(src.minQty) : "",
    maxQty: src?.maxQty !== undefined ? String(src.maxQty) : "",
    leadTimeDays: src?.leadTimeDays !== undefined ? String(src.leadTimeDays) : "",
    expectedWastePct: src?.expectedWastePct !== undefined ? String(src.expectedWastePct) : "",
    tags: src?.tags?.join(", ") ?? "",
    description: src?.description ?? "",
    openingQty: "",
    brand: src?.brand ?? "",
    weight: src?.weight !== undefined ? String(src.weight) : "",
    mapPrice: src?.mapPrice !== undefined ? String(src.mapPrice) : "",
    uoms: uomsText(src?.uoms),
    purchaseUnit: src?.purchaseUnit ?? "",
    salesUnit: src?.salesUnit ?? "",
  };
}

const num = (s: string): number | undefined => (s.trim() === "" ? undefined : Number(s));

interface ItemFormModalProps {
  open: boolean;
  onClose: () => void;
  /** Pass an item to edit it; omit to create. */
  item?: Item | null;
  defaults?: Partial<Item>;
  onSaved?: (item: Item) => void;
}

/** Create or edit an item. Mounts the form only while open so state resets on each opening. */
export function ItemFormModal(props: ItemFormModalProps) {
  if (!props.open) return null;
  return <ItemForm {...props} />;
}

function ItemForm({ open, onClose, item, defaults, onSaved }: ItemFormModalProps) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const items = useItems();
  const suppliers = useCollection("suppliers");
  const [f, setF] = useState<FormState>(() => fromItem(item, defaults));
  const settings = useSettings();
  const typeOptions = itemTypeOptions(settings);
  const customFields = customFieldsFor(settings, "items");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = !!item;
  const features = useFeatures();
  const terms = useTerms();
  const [pickAsParts, setPickAsParts] = useState(!!(item ?? defaults)?.pickAsParts);
  const parsedUoms = useMemo(() => parseUoms(f.uoms), [f.uoms]);
  // Units a document line can start in: the stocking unit, the item's own units, and standard units of the same kind.
  const unitChoices = useMemo(() => unitOptions({ unit: f.unit.trim() || "ea", uoms: parsedUoms.uoms }).map((u) => ({ value: u.source === "stock" ? "" : u.unit, label: u.source === "stock" ? `${u.unit} (stocking unit)` : u.label ? `${u.unit} · ${u.label}` : u.unit })), [f.unit, parsedUoms.uoms]);

  const categories = useMemo(() => Array.from(new Set(items.map((i) => i.category).filter(Boolean) as string[])).sort(), [items]);
  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));

  // Field-level validation: numbers must be non-negative and max must not sit below min.
  const numErr = (v: string, integer = false): string | undefined => {
    if (v.trim() === "") return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) return "Enter a number";
    if (n < 0) return "Cannot be negative";
    if (integer && !Number.isInteger(n)) return "Whole numbers only";
    return undefined;
  };
  const errors = {
    unitCost: numErr(f.unitCost),
    price: numErr(f.price),
    salePrice: numErr(f.salePrice),
    minQty: numErr(f.minQty),
    maxQty: numErr(f.maxQty) ?? (f.minQty.trim() !== "" && f.maxQty.trim() !== "" && Number(f.maxQty) < Number(f.minQty) ? "Max must be at least min" : undefined),
    leadTimeDays: numErr(f.leadTimeDays, true),
    expectedWastePct: numErr(f.expectedWastePct),
    openingQty: numErr(f.openingQty),
    weight: numErr(f.weight),
    mapPrice: numErr(f.mapPrice),
    uoms: parsedUoms.bad.length ? `Could not read: ${parsedUoms.bad.join(", ")}. Write each as name=quantity, e.g. case=12.` : undefined,
  };
  const lowestPrice = Math.min(...[f.price, f.salePrice].filter((v) => v.trim() !== "").map(Number).filter(Number.isFinite));
  const belowMap = f.mapPrice.trim() !== "" && Number.isFinite(lowestPrice) && lowestPrice < Number(f.mapPrice);
  const invalid = Object.values(errors).some(Boolean);
  const clearsBom = editing && !!item && item.type === "assembly" && f.type !== "assembly" && item.bom.length > 0;

  const submit = async () => {
    if (!f.sku.trim() || !f.name.trim()) return setError(`${terms.itemCode} and name are required`);
    if (invalid) return setError("Fix the highlighted fields first");
    setBusy(true);
    setError(null);
    const fields: Partial<Item> = {
      sku: f.sku.trim().toUpperCase(),
      name: f.name.trim(),
      type: f.type,
      color: f.type === "assembly" && f.color ? f.color : undefined,
      attributes: Object.fromEntries(Object.entries(f.attributes).filter(([, v]) => v.trim())),
      category: f.category.trim() || undefined,
      unit: f.unit.trim() || "ea",
      status: f.status,
      supplierId: f.supplierId || undefined,
      supplierSku: f.supplierSku.trim() || undefined,
      location: f.location.trim() || undefined,
      barcode: f.barcode.trim() || undefined,
      unitCost: num(f.unitCost) ?? 0,
      price: num(f.price) ?? 0,
      salePrice: num(f.salePrice),
      minQty: num(f.minQty),
      maxQty: num(f.maxQty),
      leadTimeDays: num(f.leadTimeDays),
      expectedWastePct: num(f.expectedWastePct),
      tags: f.tags.split(",").map((t) => t.trim()).filter(Boolean),
      description: f.description.trim() || undefined,
      brand: f.brand.trim() || undefined,
      weight: num(f.weight),
      // Fields that belong to a feature are only written while it is on, so switching one off never wipes what was entered.
      ...(features.mapPricing ? { mapPrice: num(f.mapPrice) } : {}),
      ...(features.unitConversions
        ? {
            uoms: parsedUoms.uoms.length ? parsedUoms.uoms : undefined,
            purchaseUnit: unitChoices.some((u) => u.value && u.value === f.purchaseUnit) ? f.purchaseUnit : undefined,
            salesUnit: unitChoices.some((u) => u.value && u.value === f.salesUnit) ? f.salesUnit : undefined,
          }
        : {}),
      ...(features.pickLists ? { pickAsParts: f.type === "assembly" && pickAsParts ? true : undefined } : {}),
      // Reactivating clears any stale supersession; dropping to a part drops the BOM with it.
      ...(f.status === "active" ? { supersededBy: undefined } : {}),
      ...(clearsBom ? { bom: [] } : {}),
    };
    try {
      if (editing && item) {
        await updateItem(store, user, item.id, fields);
        toast(`Saved ${fields.sku}`, "success");
        onSaved?.({ ...item, ...fields } as Item);
      } else {
        const [created] = await createItems(store, user, [{ ...fields, sku: fields.sku!, name: fields.name!, openingQty: num(f.openingQty) }]);
        toast(`Created ${created!.sku}`, "success");
        onSaved?.(created!);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${item?.sku}` : "New item"}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={invalid}>
            {editing ? "Save changes" : "Create item"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FormGrid cols={3}>
          <TextField label={terms.itemCode} value={f.sku} onChange={set("sku")} placeholder="ENC-125B-RAW" autoFocus={!editing} className="font-mono uppercase" />
          <div className="sm:col-span-2">
            <TextField label="Name" value={f.name} onChange={set("name")} placeholder="1590B aluminum enclosure, raw" />
          </div>
          <div className="flex flex-col gap-2">
            <Select label="Type" value={f.type} onChange={set("type")} options={typeOptions.some((o) => o.value === f.type) ? typeOptions : [...typeOptions, { value: f.type, label: f.type }]} help={clearsBom ? `Switching away from assembly removes its ${item!.bom.length}-line BOM` : undefined} />
            {f.type === "assembly" && (
              <div className="flex items-center gap-1.5">
                <span className="mr-1 text-[12px] text-text-secondary">Chip color</span>
                {ASSEMBLY_COLORS.map((c) => (
                  <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={f.color === c} onClick={() => setF((cur) => ({ ...cur, color: cur.color === c ? "" : c }))} className={`h-5 w-5 rounded-full border-2 ${f.color === c ? "border-text" : "border-transparent"}`} style={{ background: c }} />
                ))}
              </div>
            )}
          </div>
          <Combobox
            label="Category"
            value={f.category}
            options={[...categories, ...(f.category && !categories.includes(f.category) ? [f.category] : [])].map((c) => ({ value: c, label: c }))}
            placeholder="Choose or create a category"
            onChange={(v) => setF((p) => ({ ...p, category: v }))}
            onCreate={(v) => setF((p) => ({ ...p, category: v }))}
            createLabel={(q) => `Create category “${q}”`}
          />
          <Select
            label="Status"
            value={f.status}
            onChange={set("status")}
            options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }, ...(f.status === "superseded" ? [{ value: "superseded", label: "Superseded" }] : [])]}
            help={f.status === "superseded" ? "Use “Supersede with another part” on the item page to change the replacement" : undefined}
          />
        </FormGrid>
        <FormGrid cols={4}>
          <TextField label="Unit cost" type="number" step="any" min={0} prefix="$" value={f.unitCost} onChange={set("unitCost")} error={errors.unitCost} />
          <TextField label="Price" type="number" step="any" min={0} prefix="$" value={f.price} onChange={set("price")} error={errors.price} />
          <TextField label="Sale price" hint="(optional)" type="number" step="any" min={0} prefix="$" value={f.salePrice} onChange={set("salePrice")} error={errors.salePrice} />
          <TextField label="Unit" value={f.unit} onChange={set("unit")} placeholder="ea" help={features.unitConversions ? "The unit stock is counted in" : undefined} />
        </FormGrid>
        {(features.mapPricing || features.unitConversions) && (
          <FormGrid cols={4}>
            {features.mapPricing && (
              <TextField label="MAP price" hint="(optional)" type="number" step="any" min={0} prefix="$" value={f.mapPrice} onChange={set("mapPrice")} error={errors.mapPrice} help={belowMap ? "The price is below this minimum advertised price" : "Minimum advertised price"} />
            )}
            {features.unitConversions && (
              <>
                <TextField label="Other units" hint="(optional)" value={f.uoms} onChange={set("uoms")} placeholder="case=12, pk100=100" error={errors.uoms} help={`How many ${f.unit.trim() || "ea"} each one holds`} />
                <Select label="Buy in" value={unitChoices.some((u) => u.value === f.purchaseUnit) ? f.purchaseUnit : ""} onChange={set("purchaseUnit")} options={unitChoices} />
                <Select label="Sell in" value={unitChoices.some((u) => u.value === f.salesUnit) ? f.salesUnit : ""} onChange={set("salesUnit")} options={unitChoices} />
              </>
            )}
          </FormGrid>
        )}
        <FormGrid cols={4}>
          <TextField label="Min qty" type="number" step="any" min={0} value={f.minQty} onChange={set("minQty")} error={errors.minQty} />
          <TextField label="Max qty" type="number" step="any" min={0} value={f.maxQty} onChange={set("maxQty")} error={errors.maxQty} />
          <TextField label="Lead time" suffix="days" type="number" min={0} value={f.leadTimeDays} onChange={set("leadTimeDays")} error={errors.leadTimeDays} />
          <TextField label="Expected waste" suffix="%" type="number" step="any" min={0} value={f.expectedWastePct} onChange={set("expectedWastePct")} error={errors.expectedWastePct} />
        </FormGrid>
        <FormGrid cols={4}>
          <Select label="Supplier" value={f.supplierId} onChange={set("supplierId")} placeholder="None" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} help="The primary supplier. More can be added on the item page." />
          <TextField label="Supplier SKU" value={f.supplierSku} onChange={set("supplierSku")} />
          <TextField label="Location" value={f.location} onChange={set("location")} placeholder="A-01" />
          <TextField label="Barcode" value={f.barcode} onChange={set("barcode")} />
        </FormGrid>
        <FormGrid cols={editing ? 3 : 4}>
          <TextField label="Brand" hint="(optional)" value={f.brand} onChange={set("brand")} placeholder="Hammond" />
          <TextField label="Weight" hint="(optional)" type="number" step="any" min={0} value={f.weight} onChange={set("weight")} error={errors.weight} />
          <TextField label="Tags" hint="comma separated" value={f.tags} onChange={set("tags")} placeholder="shopify, bestseller" />
          {!editing && <TextField label="Opening quantity" hint="(optional)" type="number" step="any" min={0} value={f.openingQty} onChange={set("openingQty")} help="Recorded as an opening count in the ledger" error={errors.openingQty} />}
        </FormGrid>
        <TextArea label="Description" hint="(optional)" value={f.description} onChange={set("description")} rows={2} />
        {features.pickLists && f.type === "assembly" && (
          <Checkbox label="Pick as parts" help="On a pick list this assembly is broken out to its components: it ships as a kit of parts, not a built unit." checked={pickAsParts} onChange={setPickAsParts} />
        )}
        <CustomFieldsEditor defs={customFields} values={f.attributes} onChange={(attributes) => setF((cur) => ({ ...cur, attributes }))} />
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>
    </Modal>
  );
}
