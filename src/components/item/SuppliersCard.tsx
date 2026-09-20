"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Mail, MoreHorizontal, Plus, Sparkles, Star, Trash2 } from "lucide-react";
import type { Item, Supplier } from "@/lib/types";
import { isLowStock, reorderQty } from "@/lib/inventory";
import { addItemSupplier, itemSupplierLinks, removeItemSupplier, setPrimarySupplier, type SupplierLink } from "@/lib/suppliers";
import { useStore, useSettings } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { formatMoney, pluralize } from "@/lib/format";
import { Badge, Button, Card, CardHeader, FormGrid, IconButton, Menu, Modal, Select, TextField, useToast } from "@/components/ui";
import { supplierHref } from "./utils";

/** Every supplier a part can come from, with the primary one first. */
export function SuppliersCard({ item, suppliers, currency, canEdit }: { item: Item; suppliers: Supplier[]; currency: string; canEdit: boolean }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const { open } = useAgent();
  const byId = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const links = itemSupplierLinks(item);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const low = isLowStock(item, useSettings().stockAlerts);
  const primary = links.find((l) => l.primary);
  const primarySupplier = primary ? byId.get(primary.supplierId) : undefined;

  const act = async (id: string, fn: () => Promise<void>, done: string) => {
    setBusy(id);
    try {
      await fn();
      toast(done, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update", "critical");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader title={links.length > 1 ? `Suppliers (${links.length})` : "Supplier"} actions={canEdit ? <Button size="sm" variant="plain" icon={<Plus />} onClick={() => setAdding(true)}>Add</Button> : undefined} />
      {links.length === 0 ? (
        <p className="text-[13px] text-text-tertiary">No supplier yet. {canEdit ? "Add one to track lead times and reorder by vendor." : ""}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {links.map((l) => (
            <SupplierRow key={l.supplierId} link={l} supplier={byId.get(l.supplierId)} item={item} currency={currency} canEdit={canEdit} busy={busy === l.supplierId} onPrimary={() => void act(l.supplierId, () => setPrimarySupplier(store, user, item, l.supplierId), `${byId.get(l.supplierId)?.name ?? "Supplier"} is now the primary supplier`)} onRemove={() => void act(l.supplierId, () => removeItemSupplier(store, user, item, l.supplierId), `${byId.get(l.supplierId)?.name ?? "Supplier"} removed from ${item.sku}`)} />
          ))}
        </ul>
      )}
      {primarySupplier && (
        <div className="mt-3 flex flex-col gap-2">
          <Button
            size="sm"
            icon={<Sparkles />}
            onClick={() =>
              open(
                `Draft a short reorder email to ${primarySupplier.name} for ${item.sku} (${item.name}). We have ${item.onHand} on hand${item.minQty !== undefined ? `, minimum ${item.minQty}` : ""}${item.maxQty !== undefined ? `, maximum ${item.maxQty}` : ""}. Suggest ordering ${reorderQty(item) || "an appropriate quantity"}${primary?.supplierSku ? ` (their part number ${primary.supplierSku})` : ""}, and ask for current lead time and pricing.${links.length > 1 ? ` We can also buy this from ${links.filter((x) => !x.primary).map((x) => byId.get(x.supplierId)?.name).filter(Boolean).join(", ")}; mention if a comparison quote is worth asking for.` : ""}`,
                { send: true },
              )
            }
          >
            Draft reorder email
          </Button>
          {low && <p className="text-[12px] text-warning">Below minimum — reorder {reorderQty(item)} to reach {item.maxQty !== undefined ? "max" : "2× min"}.</p>}
        </div>
      )}
      <AddSupplierModal open={adding} onClose={() => setAdding(false)} item={item} suppliers={suppliers.filter((s) => !links.some((l) => l.supplierId === s.id))} currency={currency} />
    </Card>
  );
}

function SupplierRow({ link, supplier, item, currency, canEdit, busy, onPrimary, onRemove }: { link: SupplierLink; supplier?: Supplier; item: Item; currency: string; canEdit: boolean; busy: boolean; onPrimary: () => void; onRemove: () => void }) {
  const lead = link.leadTimeDays ?? (link.primary ? item.leadTimeDays : undefined) ?? supplier?.leadTimeDays;
  return (
    <li className="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 text-[13px]">
        <div className="flex flex-wrap items-center gap-1.5">
          {supplier ? (
            <Link href={supplierHref(supplier.id)} className="font-medium text-accent hover:underline">
              {supplier.name}
            </Link>
          ) : (
            <span className="text-text-tertiary">Unknown supplier</span>
          )}
          {link.primary && <Badge tone="success">Primary</Badge>}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-text-secondary">
          {link.supplierSku && <span>Part no. <span className="font-mono">{link.supplierSku}</span></span>}
          {lead !== undefined && <span>Lead {pluralize(lead, "day")}</span>}
          {link.unitCost !== undefined && <span>Last {formatMoney(link.unitCost, currency)}</span>}
          {supplier?.terms && <span>{supplier.terms}</span>}
          {supplier?.email && (
            <a href={`mailto:${supplier.email}`} className="inline-flex items-center gap-1 text-accent hover:underline">
              <Mail className="h-3 w-3" /> Email
            </a>
          )}
          {link.note && <span className="text-text-tertiary">{link.note}</span>}
        </div>
      </div>
      {canEdit && (
        <Menu
          align="right"
          trigger={<IconButton size="sm" variant="plain" aria-label={`Actions for ${supplier?.name ?? "supplier"}`} icon={<MoreHorizontal />} loading={busy} />}
          items={[...(link.primary ? [] : [{ label: "Make primary", icon: <Star />, onSelect: onPrimary }]), { label: "Remove from this item", icon: <Trash2 />, destructive: true, onSelect: onRemove }]}
        />
      )}
    </li>
  );
}

function AddSupplierModal({ open, onClose, item, suppliers, currency }: { open: boolean; onClose: () => void; item: Item; suppliers: Supplier[]; currency: string }) {
  if (!open) return null;
  return <AddSupplierForm onClose={onClose} item={item} suppliers={suppliers} currency={currency} />;
}

function AddSupplierForm({ onClose, item, suppliers, currency }: { onClose: () => void; item: Item; suppliers: Supplier[]; currency: string }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [sku, setSku] = useState("");
  const [cost, setCost] = useState("");
  const [lead, setLead] = useState("");
  const [note, setNote] = useState("");
  const [primary, setPrimary] = useState(!item.supplierId);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!supplierId) return;
    setBusy(true);
    try {
      await addItemSupplier(store, user, item, { supplierId, supplierSku: sku, unitCost: cost.trim() ? Number(cost) : undefined, leadTimeDays: lead.trim() ? Number(lead) : undefined, note }, { makePrimary: primary });
      toast(`${suppliers.find((s) => s.id === supplierId)?.name ?? "Supplier"} added to ${item.sku}`, "success");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add the supplier", "critical");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={`Add a supplier to ${item.sku}`}
      subtitle="A part can be bought from several suppliers; each keeps its own part number and last price."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void submit()} loading={busy} disabled={!supplierId}>
            Add supplier
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {suppliers.length === 0 ? (
          <p className="text-[13px] text-text-secondary">
            Every supplier is already on this item, or none exist yet.{" "}
            <Link href="/suppliers" className="text-accent hover:underline">
              Add suppliers
            </Link>
            .
          </p>
        ) : (
          <>
            <Select label="Supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} autoFocus />
            <FormGrid cols={2}>
              <TextField label="Their part number" hint="(optional)" value={sku} onChange={(e) => setSku(e.target.value)} />
              <TextField label={`Last price (${currency})`} hint="(optional)" type="number" min={0} step="any" value={cost} onChange={(e) => setCost(e.target.value)} />
              <TextField label="Lead time (days)" hint="(optional)" type="number" min={0} value={lead} onChange={(e) => setLead(e.target.value)} />
              <TextField label="Note" hint="(optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="MOQ 100, ships from EU…" />
            </FormGrid>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" className="accent-[var(--accent)]" checked={primary} onChange={(e) => setPrimary(e.target.checked)} disabled={!item.supplierId} />
              Make this the primary supplier{!item.supplierId ? " (first supplier is primary)" : ""}
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}
