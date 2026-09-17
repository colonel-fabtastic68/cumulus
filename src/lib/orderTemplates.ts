import type { Address, OrderTemplate } from "@/lib/types";
import type { Store } from "@/lib/store/types";
import type { Actor } from "@/lib/inventory";
import { newId, nowIso } from "@/lib/utils";

export interface OrderTemplateInput {
  name: string;
  description?: string;
  customer?: string;
  customerEmail?: string;
  shipTo?: Address;
  lines: Array<{ itemId: string; qty: number; unitPrice?: number }>;
  note?: string;
}

/** Saves an order's customer, lines and note under a name so similar orders start pre-filled. */
export async function saveOrderTemplate(store: Store, actor: Actor, input: OrderTemplateInput, existingId?: string): Promise<OrderTemplate> {
  const now = nowIso();
  const existing = existingId ? await store.get("orderTemplates", existingId) : null;
  const template: OrderTemplate = {
    id: existing?.id ?? newId("otpl"),
    name: input.name.trim() || "Template",
    description: input.description?.trim() || undefined,
    customer: input.customer?.trim() || undefined,
    customerEmail: input.customerEmail?.trim() || undefined,
    shipTo: input.shipTo?.street1?.trim() ? input.shipTo : undefined,
    lines: input.lines.filter((l) => l.itemId && l.qty > 0).map((l) => ({ itemId: l.itemId, qty: l.qty, ...(l.unitPrice !== undefined && Number.isFinite(l.unitPrice) ? { unitPrice: l.unitPrice } : {}) })),
    note: input.note?.trim() || undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    createdBy: existing?.createdBy ?? actor.id,
  };
  await store.put("orderTemplates", template);
  return template;
}

export async function deleteOrderTemplate(store: Store, id: string): Promise<void> {
  await store.remove("orderTemplates", id);
}
