"use client";

import { useMemo, useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import type { WorkspaceSettings } from "@/lib/types";
import { listedCategories } from "@/lib/catalog";
import { bulkPatchItems } from "@/lib/inventory";
import { useCurrentUser } from "@/lib/auth";
import { useItems, useStore } from "@/lib/store/provider";
import { pluralize } from "@/lib/format";
import { Button, ConfirmDialog, IconButton, Select, TextField, useToast } from "@/components/ui";
import { useSaveSettings } from "./useSaveSettings";

/**
 * The categories items are filed under: the list kept in Settings plus any an
 * item already carries. Renaming moves every item with the old name; deleting
 * a category in use moves its items to another one or clears them.
 */
export function CategoriesSection({ settings, readOnly }: { settings: WorkspaceSettings; readOnly: boolean }) {
  const store = useStore();
  const user = useCurrentUser();
  const items = useItems();
  const saveSettings = useSaveSettings();
  const toast = useToast();
  const listed = listedCategories(settings);

  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const i of items) {
      const c = i.category?.trim();
      if (c) out.set(c, (out.get(c) ?? 0) + 1);
    }
    return out;
  }, [items]);
  const all = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of [...listed, ...counts.keys()]) if (c.trim() && !seen.has(c.trim().toLowerCase())) seen.set(c.trim().toLowerCase(), c.trim());
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [listed, counts]);

  const [adding, setAdding] = useState("");
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [busy, setBusy] = useState(false);

  const itemsIn = (category: string) => items.filter((i) => (i.category?.trim() ?? "").toLowerCase() === category.toLowerCase());
  const persist = (categories: string[]) => saveSettings({ catalog: { ...(settings.catalog ?? {}), categories: Array.from(new Set(categories.map((c) => c.trim()).filter(Boolean))) } });

  const add = async () => {
    const name = adding.trim();
    if (!name) return;
    if (all.some((c) => c.toLowerCase() === name.toLowerCase())) return toast(`${name} is already a category`, "default");
    setBusy(true);
    try {
      await persist([...listed, name]);
      setAdding("");
      toast(`Added ${name}`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "critical");
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    if (!renaming) return;
    const from = renaming.from;
    const to = renaming.to.trim();
    if (!to || to === from) return setRenaming(null);
    setBusy(true);
    try {
      const moved = itemsIn(from);
      if (moved.length) await bulkPatchItems(store, user, moved.map((i) => ({ id: i.id, patch: { category: to } })), `Category ${from} renamed to ${to}`);
      await persist([...listed.filter((c) => c.toLowerCase() !== from.toLowerCase()), to]);
      const merged = all.some((c) => c.toLowerCase() === to.toLowerCase() && c.toLowerCase() !== from.toLowerCase());
      toast(merged ? `Merged ${from} into ${to} (${pluralize(moved.length, "item")} moved)` : `Renamed ${from} to ${to}${moved.length ? ` on ${pluralize(moved.length, "item")}` : ""}`, "success");
      setRenaming(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not rename", "critical");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const category = deleting;
    if (!category) return;
    setBusy(true);
    try {
      const affected = itemsIn(category);
      if (affected.length) await bulkPatchItems(store, user, affected.map((i) => ({ id: i.id, patch: { category: moveTo || undefined } })), moveTo ? `Category ${category} deleted, items moved to ${moveTo}` : `Category ${category} deleted`);
      await persist(listed.filter((c) => c.toLowerCase() !== category.toLowerCase()));
      toast(affected.length ? `Deleted ${category}: ${pluralize(affected.length, "item")} ${moveTo ? `moved to ${moveTo}` : "left without a category"}` : `Deleted ${category}`, "success");
      setDeleting(null);
      setMoveTo("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not delete", "critical");
    } finally {
      setBusy(false);
    }
  };

  const deletingCount = deleting ? itemsIn(deleting).length : 0;

  return (
    <div className="flex flex-col gap-4">
      {all.length === 0 ? (
        <p className="text-[13px] text-text-secondary">No categories yet. Add one here, or type a new category on any item.</p>
      ) : (
        <ul className="divide-y divide-border rounded-[var(--radius)] border border-border">
          {all.map((c) => {
            const n = counts.get(c) ?? 0;
            const editing = renaming?.from === c;
            return (
              <li key={c} className="flex flex-wrap items-center gap-2 px-3 py-2">
                {editing ? (
                  <>
                    <TextField
                      value={renaming.to}
                      onChange={(e) => setRenaming({ from: c, to: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void rename();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      aria-label={`New name for ${c}`}
                      containerClassName="min-w-[200px] flex-1"
                      autoFocus
                    />
                    <Button size="sm" variant="primary" icon={<Check />} onClick={() => void rename()} loading={busy}>
                      Rename
                    </Button>
                    <IconButton variant="plain" size="sm" aria-label="Cancel" onClick={() => setRenaming(null)}>
                      <X className="h-3.5 w-3.5" />
                    </IconButton>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-text">{c}</span>
                    <span className="text-[12.5px] text-text-tertiary">{n ? pluralize(n, "item") : "not in use"}</span>
                    {!listed.some((l) => l.toLowerCase() === c.toLowerCase()) && <span className="rounded-full bg-surface-hover px-2 text-[11px] text-text-secondary">from items</span>}
                    {!readOnly && (
                      <>
                        <IconButton variant="plain" size="sm" aria-label={`Rename ${c}`} onClick={() => setRenaming({ from: c, to: c })} disabled={busy}>
                          <Pencil className="h-3.5 w-3.5" />
                        </IconButton>
                        <IconButton variant="plain" size="sm" aria-label={`Delete ${c}`} className="text-text-tertiary hover:text-critical" onClick={() => setDeleting(c)} disabled={busy}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </IconButton>
                      </>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && (
        <div className="flex flex-wrap items-end gap-2">
          <TextField
            label="New category"
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
            placeholder="Finished goods"
            containerClassName="min-w-[220px] flex-1 sm:max-w-[320px]"
          />
          <Button icon={<Plus />} onClick={() => void add()} loading={busy} disabled={!adding.trim()}>
            Add category
          </Button>
        </div>
      )}
      <p className="text-[12px] text-text-tertiary">Renaming a category moves every item filed under it. A name that already exists merges the two.</p>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => {
          setDeleting(null);
          setMoveTo("");
        }}
        onConfirm={() => void remove()}
        destructive
        title={`Delete ${deleting ?? ""}?`}
        confirmLabel={deletingCount ? (moveTo ? `Delete and move ${pluralize(deletingCount, "item")}` : `Delete and clear ${pluralize(deletingCount, "item")}`) : "Delete"}
        loading={busy}
        message={
          deletingCount ? (
            <div className="flex flex-col gap-3">
              <p>
                {pluralize(deletingCount, "item")} {deletingCount === 1 ? "is" : "are"} filed under {deleting}. Pick where {deletingCount === 1 ? "it goes" : "they go"}, or leave them without a category.
              </p>
              <Select label="Move items to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} options={[{ value: "", label: "No category" }, ...all.filter((c) => c !== deleting).map((c) => ({ value: c, label: c }))]} />
            </div>
          ) : (
            <>No items use {deleting}; it is only removed from the list.</>
          )
        }
      />
    </div>
  );
}
