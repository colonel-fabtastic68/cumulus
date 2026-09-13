import type { Item, ItemSupplier } from "@/lib/types";
import type { Store, WriteOp } from "@/lib/store/types";
import { updateItem, type Actor, type ItemPatch } from "@/lib/inventory";

/**
 * A part can be bought from several suppliers. The primary one lives on
 * supplierId / supplierSku (reports and reorder plans group by it); the rest
 * sit in item.suppliers. Every helper here sees them as one list.
 */

export interface SupplierLink extends ItemSupplier {
  primary: boolean;
}

export function itemSupplierLinks(item: Item): SupplierLink[] {
  const out: SupplierLink[] = [];
  if (item.supplierId) out.push({ supplierId: item.supplierId, supplierSku: item.supplierSku, leadTimeDays: item.leadTimeDays, primary: true });
  for (const s of item.suppliers ?? []) if (s.supplierId !== item.supplierId && !out.some((o) => o.supplierId === s.supplierId)) out.push({ ...s, primary: false });
  return out;
}

export function itemHasSupplier(item: Item, supplierId: string): boolean {
  return item.supplierId === supplierId || (item.suppliers ?? []).some((s) => s.supplierId === supplierId);
}

export function supplierLinkFor(item: Item, supplierId: string): SupplierLink | undefined {
  return itemSupplierLinks(item).find((l) => l.supplierId === supplierId);
}

/** Every item that lists the supplier, primary or not: a part counts for each supplier it can come from. */
export function supplierItems(items: Item[], supplierId: string): Item[] {
  return items.filter((i) => itemHasSupplier(i, supplierId));
}

function alternates(item: Item, without?: string): ItemSupplier[] {
  return (item.suppliers ?? []).filter((s) => s.supplierId !== without);
}

/** Adds (or updates) a supplier on a part. The first supplier becomes the primary. */
export async function addItemSupplier(store: Store, actor: Actor, item: Item, link: ItemSupplier, opts: { makePrimary?: boolean } = {}): Promise<void> {
  const clean: ItemSupplier = { supplierId: link.supplierId, ...(link.supplierSku?.trim() ? { supplierSku: link.supplierSku.trim() } : {}), ...(link.unitCost !== undefined && Number.isFinite(link.unitCost) ? { unitCost: link.unitCost } : {}), ...(link.leadTimeDays !== undefined && Number.isFinite(link.leadTimeDays) ? { leadTimeDays: link.leadTimeDays } : {}), ...(link.note?.trim() ? { note: link.note.trim() } : {}) };
  if (!item.supplierId || (opts.makePrimary && item.supplierId !== link.supplierId)) {
    const demoted: ItemSupplier[] = item.supplierId ? [{ supplierId: item.supplierId, ...(item.supplierSku ? { supplierSku: item.supplierSku } : {}) }] : [];
    const patch: ItemPatch = { supplierId: clean.supplierId, supplierSku: clean.supplierSku, suppliers: [...demoted, ...alternates(item, clean.supplierId).filter((s) => s.supplierId !== item.supplierId)] };
    if (clean.leadTimeDays !== undefined && item.leadTimeDays === undefined) patch.leadTimeDays = clean.leadTimeDays;
    await updateItem(store, actor, item.id, patch, "Supplier added");
    return;
  }
  if (item.supplierId === clean.supplierId) {
    await updateItem(store, actor, item.id, { supplierSku: clean.supplierSku ?? item.supplierSku }, "Supplier updated");
    return;
  }
  await updateItem(store, actor, item.id, { suppliers: [...alternates(item, clean.supplierId), clean] }, "Supplier added");
}

/** Removes a supplier from a part. Removing the primary promotes the next one. */
export async function removeItemSupplier(store: Store, actor: Actor, item: Item, supplierId: string): Promise<void> {
  if (item.supplierId === supplierId) {
    const [next, ...rest] = alternates(item, supplierId);
    await updateItem(store, actor, item.id, { supplierId: next?.supplierId, supplierSku: next?.supplierSku, suppliers: rest }, "Supplier removed");
    return;
  }
  await updateItem(store, actor, item.id, { suppliers: alternates(item, supplierId) }, "Supplier removed");
}

export async function setPrimarySupplier(store: Store, actor: Actor, item: Item, supplierId: string): Promise<void> {
  const link = supplierLinkFor(item, supplierId);
  if (!link || link.primary) return;
  await addItemSupplier(store, actor, item, link, { makePrimary: true });
}

/** Patches that drop a supplier from every item, for when the supplier itself is deleted. */
export function patchesUnlinkingSupplier(items: Item[], supplierId: string): Array<{ id: string; patch: ItemPatch }> {
  return supplierItems(items, supplierId).map((item) => {
    if (item.supplierId === supplierId) {
      const [next, ...rest] = alternates(item, supplierId);
      return { id: item.id, patch: { supplierId: next?.supplierId, supplierSku: next?.supplierSku, suppliers: rest } };
    }
    return { id: item.id, patch: { suppliers: alternates(item, supplierId) } };
  });
}

export type { WriteOp };
