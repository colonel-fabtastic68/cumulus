import type { Item } from "@/lib/types";
import type { Store } from "@/lib/store/types";
import { activityOp, InventoryError, type Actor } from "@/lib/inventory";
import { nowIso } from "@/lib/utils";

/**
 * Categories are free text on items, so they drift: "Brakes", "brakes",
 * "Brake parts". Renaming one changes it on every item that carries it;
 * renaming onto a name that already exists merges the two.
 */

export interface CategoryCount {
  name: string;
  count: number;
}

/** Every category in use with how many items carry it, A to Z. */
export function categoryCounts(items: Pick<Item, "category">[]): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const i of items) {
    const c = i.category?.trim();
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Categories that differ only by capitals or spacing: likely the same thing typed twice. */
export function similarCategories(items: Pick<Item, "category">[]): string[][] {
  const groups = new Map<string, string[]>();
  for (const { name } of categoryCounts(items)) {
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    groups.set(key, [...(groups.get(key) ?? []), name]);
  }
  return Array.from(groups.values()).filter((g) => g.length > 1);
}

/**
 * Renames a category on every item that has it. When `to` is already a
 * category the two are merged. An empty `to` clears the category.
 */
export async function renameCategory(store: Store, actor: Actor, from: string, to: string): Promise<{ changed: number; merged: boolean }> {
  const source = from.trim();
  const target = to.trim();
  if (!source) throw new InventoryError("Choose the category to rename");
  if (source === target) return { changed: 0, merged: false };
  const items = await store.list("items");
  const affected = items.filter((i) => i.category?.trim() === source);
  if (affected.length === 0) throw new InventoryError(`No items are in “${source}”`);
  // Merging onto an existing name keeps that name's spelling.
  const existing = categoryCounts(items).find((c) => c.name !== source && c.name.toLowerCase() === target.toLowerCase());
  const final = existing?.name ?? target;
  const merged = !!existing || items.some((i) => i.category?.trim() === final && final !== "");
  const now = nowIso();
  await store.batch([
    ...affected.map((i) => ({ op: "patch" as const, collection: "items" as const, id: i.id, patch: { category: final || undefined, updatedAt: now, updatedBy: actor.id } })),
    activityOp(actor, "category.renamed", final ? `${actor.name} ${merged ? "merged" : "renamed"} category “${source}” ${merged ? "into" : "to"} “${final}” · ${affected.length} item${affected.length === 1 ? "" : "s"}` : `${actor.name} cleared category “${source}” from ${affected.length} item${affected.length === 1 ? "" : "s"}`, { meta: { from: source, to: final, count: affected.length, merged } }),
  ]);
  return { changed: affected.length, merged };
}
