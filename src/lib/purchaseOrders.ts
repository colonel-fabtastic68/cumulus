import type { Address, Item, PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus, PurchaseOrderTemplate, Receipt, Supplier } from "@/lib/types";
import type { Store, WriteOp } from "@/lib/store/types";
import { activityOp, InventoryError, nextNumber, receiveStock, type Actor, type ReceiveLineInput } from "@/lib/inventory";
import { supplierLinkFor } from "@/lib/suppliers";
import { newId, nowIso, round, sum, uniq } from "@/lib/utils";

/**
 * Purchase orders: what was ordered from a supplier, what has arrived, and
 * what is still due. Stock only moves through receipts booked against the
 * order, so the ledger stays the single source of truth. Templates keep a
 * supplier and lines for orders that repeat. Several orders to one supplier
 * can be merged into one, or received together on one delivery.
 */

export const PO_OPEN_STATUSES: PurchaseOrderStatus[] = ["draft", "sent", "partial"];

export function poIsOpen(po: Pick<PurchaseOrder, "status">): boolean {
  return PO_OPEN_STATUSES.includes(po.status);
}

export function poLineOpenQty(line: PurchaseOrderLine): number {
  return Math.max(0, round(line.qty - (line.received ?? 0), 4));
}

export function poOpenLines(po: PurchaseOrder): PurchaseOrderLine[] {
  return po.lines.filter((l) => poLineOpenQty(l) > 0);
}

export function poTotal(po: Pick<PurchaseOrder, "lines">): number {
  return round(sum(po.lines.map((l) => l.qty * l.unitCost)));
}

export function poOrderedUnits(po: Pick<PurchaseOrder, "lines">): number {
  return sum(po.lines.map((l) => l.qty));
}

export function poReceivedUnits(po: Pick<PurchaseOrder, "lines">): number {
  return sum(po.lines.map((l) => l.received ?? 0));
}

/** An order is late when it is still open past its expected date. */
export function poIsOverdue(po: PurchaseOrder, today = new Date().toISOString().slice(0, 10)): boolean {
  return poIsOpen(po) && !!po.expectedAt && po.expectedAt < today;
}

/** Still open and expected within the next `days` days (not yet late). */
export function poDueWithin(po: PurchaseOrder, days: number, now = Date.now()): boolean {
  if (!poIsOpen(po) || !po.expectedAt) return false;
  const today = new Date(now).toISOString().slice(0, 10);
  const until = new Date(now + days * 86_400_000).toISOString().slice(0, 10);
  return po.expectedAt >= today && po.expectedAt <= until;
}

/** What this supplier last charged for the item, else the item's standard cost. */
export function unitCostFor(item: Item, supplierId?: string): number {
  if (supplierId) {
    const link = supplierLinkFor(item, supplierId);
    if (link?.unitCost !== undefined && Number.isFinite(link.unitCost)) return link.unitCost;
  }
  return item.unitCost;
}

/** Units of each item still due on open orders, so a forecast knows what is already coming. */
export function openPurchaseQty(purchaseOrders: PurchaseOrder[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const po of purchaseOrders) {
    if (!poIsOpen(po)) continue;
    for (const l of po.lines) {
      const open = poLineOpenQty(l);
      if (open > 0) out.set(l.itemId, round((out.get(l.itemId) ?? 0) + open, 4));
    }
  }
  return out;
}

export interface PurchaseOrderLineInput {
  itemId: string;
  qty: number;
  unitCost?: number;
  note?: string;
}

export interface PurchaseOrderInput {
  supplierId?: string;
  /** Supplier name when there is no record, or to print something other than the record's name. */
  supplier?: string;
  /** Leave blank for the next PO number. */
  number?: string;
  lines: PurchaseOrderLineInput[];
  expectedAt?: string;
  shipTo?: Address;
  terms?: string;
  reference?: string;
  note?: string;
  templateId?: string;
  source?: PurchaseOrder["source"];
  /** Mark it sent straight away instead of leaving a draft. */
  send?: boolean;
}

function supplierName(suppliers: Supplier[], input: { supplierId?: string; supplier?: string }): string {
  const record = input.supplierId ? suppliers.find((s) => s.id === input.supplierId) : undefined;
  return (input.supplier?.trim() || record?.name || "").trim();
}

function buildLines(items: Item[], supplierId: string | undefined, inputs: PurchaseOrderLineInput[]): PurchaseOrderLine[] {
  if (inputs.length === 0) throw new InventoryError("A purchase order needs at least one line");
  const byId = new Map(items.map((i) => [i.id, i]));
  const merged = new Map<string, PurchaseOrderLine>();
  for (const l of inputs) {
    const item = byId.get(l.itemId);
    if (!item) throw new InventoryError(`Unknown item ${l.itemId}`);
    const qty = Number(l.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new InventoryError(`Quantity for ${item.sku} must be positive`);
    const unitCost = l.unitCost !== undefined && Number.isFinite(l.unitCost) ? l.unitCost : unitCostFor(item, supplierId);
    if (unitCost < 0) throw new InventoryError(`Unit cost for ${item.sku} cannot be negative`);
    const existing = merged.get(item.id);
    if (existing) {
      existing.qty = round(existing.qty + qty, 4);
      continue;
    }
    const supplierSku = supplierId ? supplierLinkFor(item, supplierId)?.supplierSku : item.supplierSku;
    merged.set(item.id, { itemId: item.id, qty, unitCost: round(unitCost, 4), ...(supplierSku ? { supplierSku } : {}), ...(l.note?.trim() ? { note: l.note.trim() } : {}) });
  }
  return Array.from(merged.values());
}

export async function createPurchaseOrder(store: Store, actor: Actor, input: PurchaseOrderInput): Promise<PurchaseOrder> {
  const [items, suppliers] = await Promise.all([store.list("items"), store.list("suppliers")]);
  const supplier = supplierName(suppliers, input);
  if (!supplier) throw new InventoryError("Choose a supplier for the purchase order");
  const lines = buildLines(items, input.supplierId, input.lines);
  const ops: WriteOp[] = [];
  let number = input.number?.trim() ?? "";
  if (!number) {
    const next = await nextNumber(store, "purchaseOrder");
    number = next.number;
    ops.push(...next.ops);
  }
  const now = nowIso();
  const po: PurchaseOrder = {
    id: newId("po"),
    number,
    supplierId: input.supplierId || undefined,
    supplier,
    status: input.send ? "sent" : "draft",
    lines,
    expectedAt: input.expectedAt?.trim() || undefined,
    shipTo: input.shipTo?.street1?.trim() ? input.shipTo : undefined,
    terms: input.terms?.trim() || undefined,
    reference: input.reference?.trim() || undefined,
    note: input.note?.trim() || undefined,
    templateId: input.templateId || undefined,
    source: input.source ?? "manual",
    sentAt: input.send ? now : undefined,
    receiptIds: [],
    createdAt: now,
    updatedAt: now,
    createdBy: actor.id,
  };
  const total = poTotal(po);
  ops.push({ op: "put", collection: "purchaseOrders", doc: po });
  ops.push(activityOp(actor, "po.created", `${actor.name} ${input.send ? "sent" : "created"} ${po.number} to ${supplier} · ${lines.length} line${lines.length === 1 ? "" : "s"} · $${total.toFixed(2)}`, { entityType: "purchaseOrder", entityId: po.id, meta: { lines: lines.length, total, source: po.source } }));
  await store.batch(ops);
  return po;
}

async function loadPo(store: Store, id: string): Promise<PurchaseOrder> {
  const po = await store.get("purchaseOrders", id);
  if (!po) throw new InventoryError("Purchase order not found");
  return po;
}

/** Edits the header and lines of an order nothing has been received against yet. */
export async function updatePurchaseOrder(store: Store, actor: Actor, id: string, patch: { supplierId?: string; supplier?: string; lines?: PurchaseOrderLineInput[]; expectedAt?: string; terms?: string; reference?: string; note?: string; shipTo?: Address }): Promise<PurchaseOrder> {
  const po = await loadPo(store, id);
  if (!poIsOpen(po)) throw new InventoryError(`${po.number} is ${po.status} and cannot be edited`);
  if (patch.lines && poReceivedUnits(po) > 0) throw new InventoryError(`${po.number} has receipts against it; add a new order for extra lines`);
  const [items, suppliers] = await Promise.all([store.list("items"), store.list("suppliers")]);
  const supplierId = patch.supplierId !== undefined ? patch.supplierId || undefined : po.supplierId;
  const supplier = patch.supplier !== undefined || patch.supplierId !== undefined ? supplierName(suppliers, { supplierId, supplier: patch.supplier ?? (patch.supplierId !== undefined ? undefined : po.supplier) }) || po.supplier : po.supplier;
  const next: PurchaseOrder = {
    ...po,
    supplierId,
    supplier,
    lines: patch.lines ? buildLines(items, supplierId, patch.lines) : po.lines,
    expectedAt: patch.expectedAt !== undefined ? patch.expectedAt.trim() || undefined : po.expectedAt,
    terms: patch.terms !== undefined ? patch.terms.trim() || undefined : po.terms,
    reference: patch.reference !== undefined ? patch.reference.trim() || undefined : po.reference,
    note: patch.note !== undefined ? patch.note.trim() || undefined : po.note,
    shipTo: patch.shipTo !== undefined ? (patch.shipTo.street1?.trim() ? patch.shipTo : undefined) : po.shipTo,
    updatedAt: nowIso(),
  };
  await store.put("purchaseOrders", next);
  return next;
}

/**
 * Adds lines to a draft. An item already on the order has the quantity added
 * to its line at the order's cost, so a draft stays one line per item.
 */
export async function addPurchaseOrderLines(store: Store, actor: Actor, id: string, inputs: PurchaseOrderLineInput[]): Promise<{ po: PurchaseOrder; added: number }> {
  const po = await loadPo(store, id);
  if (po.status !== "draft") throw new InventoryError(`${po.number} is ${po.status === "sent" ? "already sent" : po.status}; only drafts take extra lines`);
  const items = await store.list("items");
  const added = buildLines(items, po.supplierId, inputs);
  const lines = po.lines.map((l) => ({ ...l }));
  for (const a of added) {
    const existing = lines.find((l) => l.itemId === a.itemId);
    if (existing) existing.qty = round(existing.qty + a.qty, 4);
    else lines.push(a);
  }
  const next: PurchaseOrder = { ...po, lines, updatedAt: nowIso() };
  await store.put("purchaseOrders", next);
  return { po: next, added: added.length };
}

export async function markPurchaseOrderSent(store: Store, actor: Actor, id: string): Promise<PurchaseOrder> {
  const po = await loadPo(store, id);
  if (po.status !== "draft") throw new InventoryError(`${po.number} is already ${po.status}`);
  const now = nowIso();
  const next: PurchaseOrder = { ...po, status: "sent", sentAt: now, updatedAt: now };
  await store.batch([{ op: "put", collection: "purchaseOrders", doc: next }, activityOp(actor, "po.sent", `${actor.name} sent ${po.number} to ${po.supplier}`, { entityType: "purchaseOrder", entityId: po.id })]);
  return next;
}

export async function cancelPurchaseOrder(store: Store, actor: Actor, id: string, reason?: string): Promise<PurchaseOrder> {
  const po = await loadPo(store, id);
  if (!poIsOpen(po)) throw new InventoryError(`${po.number} is already ${po.status}`);
  const now = nowIso();
  const next: PurchaseOrder = { ...po, status: "cancelled", cancelledAt: now, updatedAt: now, note: reason?.trim() ? [po.note, `Cancelled: ${reason.trim()}`].filter(Boolean).join("\n") : po.note };
  await store.batch([{ op: "put", collection: "purchaseOrders", doc: next }, activityOp(actor, "po.cancelled", `${actor.name} cancelled ${po.number}${reason?.trim() ? `: ${reason.trim()}` : ""}${poReceivedUnits(po) > 0 ? " (goods already received stay on the shelf)" : ""}`, { entityType: "purchaseOrder", entityId: po.id })]);
  return next;
}

// ---- merging --------------------------------------------------------------------

function supplierKey(po: Pick<PurchaseOrder, "supplierId" | "supplier">): string {
  return po.supplierId ?? `name:${po.supplier.trim().toLowerCase()}`;
}

/** True when the orders go to the same supplier, so one delivery (or one merged order) can cover them. */
export function sameSupplier(pos: Array<Pick<PurchaseOrder, "supplierId" | "supplier">>): boolean {
  return new Set(pos.map(supplierKey)).size <= 1;
}

/** Why a set of orders cannot be folded into one, or null when they can. */
export function mergeBlocker(pos: PurchaseOrder[]): string | null {
  if (pos.length < 2) return "Choose at least two orders to merge";
  for (const po of pos) {
    if (!poIsOpen(po)) return `${po.number} is ${po.status}`;
    if (poReceivedUnits(po) > 0) return `${po.number} already has goods received against it`;
  }
  if (!sameSupplier(pos)) return "The orders go to different suppliers";
  return null;
}

/**
 * Folds several open orders to one supplier into one. The oldest (or the one
 * chosen) keeps its number and header; the others' lines move onto it (an item
 * on both gets the quantities added at the quantity-weighted cost), and they
 * close as merged with a pointer to the survivor. Nothing moves in stock.
 */
export async function mergePurchaseOrders(store: Store, actor: Actor, ids: string[], opts: { into?: string } = {}): Promise<PurchaseOrder> {
  const pos = (await Promise.all(uniq(ids).map((id) => loadPo(store, id)))).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const blocker = mergeBlocker(pos);
  if (blocker) throw new InventoryError(blocker);
  const target = opts.into ? pos.find((p) => p.id === opts.into) : pos[0];
  if (!target) throw new InventoryError("The order to merge into is not among the chosen orders");
  const sources = pos.filter((p) => p.id !== target.id);
  const lines = target.lines.map((l) => ({ ...l }));
  for (const src of sources) {
    for (const l of src.lines) {
      const existing = lines.find((x) => x.itemId === l.itemId);
      if (!existing) {
        lines.push({ ...l });
        continue;
      }
      const qty = round(existing.qty + l.qty, 4);
      existing.unitCost = round((existing.qty * existing.unitCost + l.qty * l.unitCost) / qty, 4);
      existing.qty = qty;
      if (!existing.supplierSku && l.supplierSku) existing.supplierSku = l.supplierSku;
      if (!existing.note && l.note) existing.note = l.note;
    }
  }
  const now = nowIso();
  const earliest = pos.map((p) => p.expectedAt).filter((d): d is string => !!d).sort()[0];
  const references = uniq(pos.map((p) => p.reference?.trim()).filter((r): r is string => !!r));
  const notes = [target.note, ...sources.map((s) => (s.note ? `${s.number}: ${s.note}` : ""))].filter(Boolean).join("\n");
  const merged: PurchaseOrder = {
    ...target,
    lines,
    expectedAt: target.expectedAt ?? earliest,
    reference: references.length ? references.join(", ") : undefined,
    note: notes || undefined,
    mergedFrom: [...(target.mergedFrom ?? []), ...sources.map((s) => s.id)],
    updatedAt: now,
  };
  const ops: WriteOp[] = [{ op: "put", collection: "purchaseOrders", doc: merged }];
  for (const src of sources) ops.push({ op: "put", collection: "purchaseOrders", doc: { ...src, status: "merged", mergedInto: target.id, mergedAt: now, updatedAt: now } });
  const sentSources = sources.filter((s) => s.status !== "draft");
  ops.push(
    activityOp(actor, "po.merged", `${actor.name} merged ${sources.map((s) => s.number).join(", ")} into ${target.number} (${target.supplier}) · ${lines.length} line${lines.length === 1 ? "" : "s"} · $${poTotal(merged).toFixed(2)}${sentSources.length ? ` · ${sentSources.map((s) => s.number).join(", ")} had already been sent; tell the supplier` : ""}`, {
      entityType: "purchaseOrder",
      entityId: target.id,
      meta: { mergedFrom: sources.map((s) => s.number), lines: lines.length, total: poTotal(merged) },
    }),
  );
  await store.batch(ops);
  return merged;
}

// ---- receiving --------------------------------------------------------------------

export interface ReceivePurchaseOrderLineInput {
  /** Which of the orders the line is for. Omit to take from the oldest order that still has the item open. */
  purchaseOrderId?: string;
  itemId: string;
  qty: number;
  unitCost?: number;
  locationId?: string;
  bin?: string;
  supplierLot?: string;
  expiresAt?: string;
}

export interface ReceivePurchaseOrderInput {
  /** Omit to receive everything still open at the ordered cost. */
  lines?: ReceivePurchaseOrderLineInput[];
  receivedAt?: string;
  locationId?: string;
  note?: string;
  /** Printed on the receipt; defaults to the order numbers. */
  reference?: string;
  updateStandardCost?: boolean;
  /** Lines for items none of the orders carry are received without an order instead of being refused (the receiving form's extra lines). */
  allowExtraLines?: boolean;
}

/**
 * Books one delivery against one or more open orders from the same supplier:
 * a normal receipt (lots, ledger, costs) whose lines each name the order they
 * close, plus the received counts on every order.
 */
export async function receivePurchaseOrders(store: Store, actor: Actor, ids: string[], input: ReceivePurchaseOrderInput = {}): Promise<{ purchaseOrders: PurchaseOrder[]; receipt: Receipt }> {
  const pos = (await Promise.all(uniq(ids).map((id) => loadPo(store, id)))).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (pos.length === 0) throw new InventoryError("Choose at least one purchase order");
  for (const po of pos) if (!poIsOpen(po)) throw new InventoryError(`${po.number} is ${po.status}; nothing can be received against it`);
  if (!sameSupplier(pos)) throw new InventoryError("One delivery comes from one supplier; receive orders from different suppliers separately");
  const items = await store.list("items");
  const skuOf = (itemId: string) => items.find((i) => i.id === itemId)?.sku ?? itemId;
  const numbers = pos.map((p) => p.number).join(", ");
  const requested: ReceivePurchaseOrderLineInput[] = input.lines ?? pos.flatMap((po) => poOpenLines(po).map((l) => ({ purchaseOrderId: po.id, itemId: l.itemId, qty: poLineOpenQty(l), unitCost: l.unitCost })));
  const openLeft = new Map<string, number>();
  for (const po of pos) for (const l of po.lines) openLeft.set(`${po.id}:${l.itemId}`, poLineOpenQty(l));
  const receiptLines: ReceiveLineInput[] = [];
  for (const r of requested) {
    const qty = Number(r.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const candidates = r.purchaseOrderId ? pos.filter((p) => p.id === r.purchaseOrderId) : pos;
    if (r.purchaseOrderId && candidates.length === 0) throw new InventoryError(`${skuOf(r.itemId)} names an order that is not being received`);
    if (!r.purchaseOrderId && input.allowExtraLines && !pos.some((p) => p.lines.some((l) => l.itemId === r.itemId))) {
      receiptLines.push({ itemId: r.itemId, qty, unitCost: r.unitCost, locationId: r.locationId ?? input.locationId, bin: r.bin, supplierLot: r.supplierLot, expiresAt: r.expiresAt });
      continue;
    }
    let remaining = qty;
    for (const po of candidates) {
      const key = `${po.id}:${r.itemId}`;
      const open = openLeft.get(key) ?? 0;
      if (open <= 0) continue;
      const take = round(Math.min(open, remaining), 4);
      const line = po.lines.find((l) => l.itemId === r.itemId)!;
      receiptLines.push({ itemId: r.itemId, qty: take, unitCost: r.unitCost ?? line.unitCost, locationId: r.locationId ?? input.locationId, bin: r.bin, supplierLot: r.supplierLot, expiresAt: r.expiresAt, purchaseOrderId: po.id });
      openLeft.set(key, round(open - take, 4));
      remaining = round(remaining - take, 4);
      if (remaining <= 1e-9) break;
    }
    if (remaining > 1e-9) {
      const onOrder = candidates.some((p) => p.lines.some((l) => l.itemId === r.itemId));
      throw new InventoryError(onOrder ? `${skuOf(r.itemId)}: ${qty} is more than the ${round(qty - remaining, 4)} still open on ${candidates.map((p) => p.number).join(", ")}` : `${skuOf(r.itemId)} is not on ${numbers}`);
    }
  }
  if (receiptLines.length === 0) throw new InventoryError("Nothing to receive: every line is already in");
  const receipt = await receiveStock(store, actor, { supplierId: pos[0]!.supplierId, reference: input.reference?.trim() || numbers, purchaseOrderIds: pos.map((p) => p.id), receivedAt: input.receivedAt, note: input.note, lines: receiptLines, updateStandardCost: input.updateStandardCost });
  const now = nowIso();
  const ops: WriteOp[] = [];
  const next: PurchaseOrder[] = [];
  const outcome: string[] = [];
  for (const po of pos) {
    const got = receiptLines.filter((r) => r.purchaseOrderId === po.id);
    if (got.length === 0) {
      next.push(po);
      continue;
    }
    const lines = po.lines.map((l) => {
      const q = sum(got.filter((r) => r.itemId === l.itemId).map((r) => r.qty));
      return q ? { ...l, received: round((l.received ?? 0) + q, 4) } : l;
    });
    const complete = lines.every((l) => poLineOpenQty(l) <= 0);
    const updated: PurchaseOrder = { ...po, lines, status: complete ? "received" : "partial", receivedAt: complete ? now : po.receivedAt, receiptIds: [...(po.receiptIds ?? []), receipt.id], updatedAt: now };
    next.push(updated);
    ops.push({ op: "put", collection: "purchaseOrders", doc: updated });
    const stillOpen = poOpenLines(updated).length;
    outcome.push(`${po.number} ${complete ? "complete" : `${stillOpen} line${stillOpen === 1 ? "" : "s"} still open`}`);
  }
  const units = sum(receiptLines.map((r) => r.qty));
  ops.push(activityOp(actor, "po.received", `${actor.name} received ${receipt.number} against ${numbers}: ${units} unit${units === 1 ? "" : "s"} on ${receiptLines.length} line${receiptLines.length === 1 ? "" : "s"} · ${outcome.join(" · ")}`, { entityType: "purchaseOrder", entityId: pos[0]!.id, meta: { receiptId: receipt.id, purchaseOrderIds: pos.map((p) => p.id), complete: next.every((p) => p.status === "received") } }));
  await store.batch(ops);
  return { purchaseOrders: next, receipt };
}

/** Books a delivery against one order. */
export async function receivePurchaseOrder(store: Store, actor: Actor, id: string, input: ReceivePurchaseOrderInput = {}): Promise<{ po: PurchaseOrder; receipt: Receipt }> {
  const { purchaseOrders, receipt } = await receivePurchaseOrders(store, actor, [id], input);
  return { po: purchaseOrders[0]!, receipt };
}

// ---- templates -------------------------------------------------------------

export interface PurchaseOrderTemplateInput {
  name: string;
  description?: string;
  supplierId?: string;
  supplier?: string;
  lines: Array<{ itemId: string; qty: number; unitCost?: number; note?: string }>;
  terms?: string;
  note?: string;
  source?: PurchaseOrderTemplate["source"];
}

export async function savePurchaseOrderTemplate(store: Store, actor: Actor, input: PurchaseOrderTemplateInput, existingId?: string): Promise<PurchaseOrderTemplate> {
  const lines = input.lines.filter((l) => l.itemId && Number(l.qty) > 0).map((l) => ({ itemId: l.itemId, qty: Number(l.qty), ...(l.unitCost !== undefined && Number.isFinite(l.unitCost) ? { unitCost: l.unitCost } : {}), ...(l.note?.trim() ? { note: l.note.trim() } : {}) }));
  if (lines.length === 0) throw new InventoryError("A template needs at least one line with a known item");
  const suppliers = await store.list("suppliers");
  const now = nowIso();
  const existing = existingId ? await store.get("purchaseOrderTemplates", existingId) : null;
  const template: PurchaseOrderTemplate = {
    id: existing?.id ?? newId("potpl"),
    name: input.name.trim() || "Template",
    description: input.description?.trim() || undefined,
    supplierId: input.supplierId || undefined,
    supplier: supplierName(suppliers, input) || undefined,
    lines,
    terms: input.terms?.trim() || undefined,
    note: input.note?.trim() || undefined,
    source: input.source ?? existing?.source ?? "manual",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    createdBy: existing?.createdBy ?? actor.id,
  };
  await store.put("purchaseOrderTemplates", template);
  return template;
}

export async function deletePurchaseOrderTemplate(store: Store, id: string): Promise<void> {
  await store.remove("purchaseOrderTemplates", id);
}

export function templateFromPurchaseOrder(po: PurchaseOrder): Omit<PurchaseOrderTemplateInput, "name"> {
  return { supplierId: po.supplierId, supplier: po.supplier, lines: po.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitCost: l.unitCost, note: l.note })), terms: po.terms, note: po.note, source: "order" };
}

/** Finds a template by name, exact first, then a unique partial match. */
export function findTemplate(templates: PurchaseOrderTemplate[], name: string): PurchaseOrderTemplate | undefined {
  const q = name.trim().toLowerCase();
  if (!q) return undefined;
  const exact = templates.find((t) => t.name.toLowerCase() === q);
  if (exact) return exact;
  const partial = templates.filter((t) => t.name.toLowerCase().includes(q));
  return partial.length === 1 ? partial[0] : undefined;
}

// ---- uploaded templates ------------------------------------------------------

const HEADER_ALIASES: Record<"sku" | "qty" | "unitCost" | "note" | "supplier", string[]> = {
  sku: ["sku", "part number", "part no", "part #", "part", "item", "item number", "item no", "item code", "product code", "code", "component", "componentpartnumber", "material", "mpn"],
  qty: ["qty", "quantity", "order qty", "qty required", "componentqtyrequired", "amount", "units", "count"],
  unitCost: ["unit cost", "cost", "unit price", "price", "each", "rate"],
  note: ["note", "notes", "comment", "comments", "description", "line note"],
  supplier: ["supplier", "vendor", "supplier name", "vendor name"],
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/_\d+$/, "").replace(/[^a-z0-9#]+/g, " ").trim();
}

/** Which uploaded column holds which field, by header name. */
export function detectTemplateColumns(headers: string[]): Partial<Record<keyof typeof HEADER_ALIASES, string>> {
  const out: Partial<Record<keyof typeof HEADER_ALIASES, string>> = {};
  const norm = headers.map((h) => ({ raw: h, key: normalizeHeader(h) }));
  for (const field of Object.keys(HEADER_ALIASES) as Array<keyof typeof HEADER_ALIASES>) {
    const aliases = HEADER_ALIASES[field];
    const hit = norm.find((h) => aliases.includes(h.key)) ?? norm.find((h) => aliases.some((a) => a.length > 3 && h.key.includes(a)));
    if (hit && !Object.values(out).includes(hit.raw)) out[field] = hit.raw;
  }
  return out;
}

export interface TemplateRowMatch {
  row: number;
  code: string;
  qty: number;
  unitCost?: number;
  note?: string;
  item?: Item;
}

export interface TemplateUpload {
  lines: Array<{ itemId: string; qty: number; unitCost?: number; note?: string }>;
  matched: TemplateRowMatch[];
  unknown: TemplateRowMatch[];
  /** A supplier named in the sheet, when every row agrees. */
  supplierName?: string;
  columns: ReturnType<typeof detectTemplateColumns>;
}

function parseNumber(v: string | undefined): number | undefined {
  const digits = (v ?? "").replace(/[^0-9.\-]/g, "");
  if (!digits) return undefined;
  const n = Number(digits);
  return Number.isFinite(n) ? n : undefined;
}

/** Turns an uploaded sheet (SKU, quantity, optional cost and note) into template lines, matching SKU, supplier SKU, barcode or a cross-reference. */
export function templateFromRows(headers: string[], rows: Record<string, string>[], items: Item[], columns = detectTemplateColumns(headers)): TemplateUpload {
  const bySku = new Map<string, Item>();
  const byOther = new Map<string, Item>();
  for (const i of items) {
    bySku.set(i.sku.toLowerCase(), i);
    if (i.supplierSku) byOther.set(i.supplierSku.toLowerCase(), i);
    for (const s of i.suppliers ?? []) if (s.supplierSku) byOther.set(s.supplierSku.toLowerCase(), i);
    if (i.barcode) byOther.set(i.barcode.toLowerCase(), i);
    for (const r of i.crossRefs ?? []) byOther.set(r.number.toLowerCase(), i);
  }
  const matched: TemplateRowMatch[] = [];
  const unknown: TemplateRowMatch[] = [];
  const suppliers = new Set<string>();
  rows.forEach((r, idx) => {
    const code = (columns.sku ? r[columns.sku] : "")?.trim() ?? "";
    const qty = parseNumber(columns.qty ? r[columns.qty] : undefined);
    if (!code || !qty || qty <= 0) return;
    const unitCost = parseNumber(columns.unitCost ? r[columns.unitCost] : undefined);
    const note = (columns.note ? r[columns.note] : "")?.trim() || undefined;
    const sup = (columns.supplier ? r[columns.supplier] : "")?.trim();
    if (sup) suppliers.add(sup);
    const item = bySku.get(code.toLowerCase()) ?? byOther.get(code.toLowerCase());
    const row: TemplateRowMatch = { row: idx + 2, code, qty, unitCost, note, item };
    (item ? matched : unknown).push(row);
  });
  const merged = new Map<string, { itemId: string; qty: number; unitCost?: number; note?: string }>();
  for (const m of matched) {
    const cur = merged.get(m.item!.id);
    if (cur) cur.qty = round(cur.qty + m.qty, 4);
    else merged.set(m.item!.id, { itemId: m.item!.id, qty: m.qty, ...(m.unitCost !== undefined ? { unitCost: m.unitCost } : {}), ...(m.note ? { note: m.note } : {}) });
  }
  return { lines: Array.from(merged.values()), matched, unknown, supplierName: suppliers.size === 1 ? Array.from(suppliers)[0] : undefined, columns };
}
