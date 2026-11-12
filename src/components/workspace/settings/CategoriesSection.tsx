"use client";

import { useMemo, useState } from "react";
import { Merge, Pencil } from "lucide-react";
import { categoryCounts, renameCategory, similarCategories } from "@/lib/categories";
import { useItems, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { pluralize } from "@/lib/format";
import { Button, Combobox, Modal, SearchField, useToast } from "@/components/ui";
import { SettingsCard } from "./SettingsCard";

/** Rename a category on every item that carries it, or fold it into another one (feature "categoryTools"). */
export function CategoriesSection({ readOnly }: { readOnly: boolean }) {
  const items = useItems();
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const categories = useMemo(() => categoryCounts(items), [items]);
  const lookalikes = useMemo(() => similarCategories(items), [items]);
  const shown = useMemo(() => categories.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase())), [categories, q]);
  const typed = name.trim();
  const existing = target ? categories.find((c) => c.name !== target && c.name.toLowerCase() === typed.toLowerCase()) : undefined;
  const count = categories.find((c) => c.name === target)?.count ?? 0;

  const open = (category: string, into = category) => {
    setTarget(category);
    setName(into);
  };

  const apply = async () => {
    if (!target || !typed || typed === target) return;
    setBusy(true);
    try {
      const res = await renameCategory(store, user, target, typed);
      toast(res.merged ? `Merged “${target}” into “${existing?.name ?? typed}” · ${pluralize(res.changed, "item")}` : `Renamed “${target}” to “${typed}” · ${pluralize(res.changed, "item")}`, "success");
      setTarget(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not rename the category", "critical");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-medium text-text">Categories</h3>
          <p className="mt-0.5 text-[12.5px] text-text-secondary">{categories.length === 0 ? "No item has a category yet." : `${pluralize(categories.length, "category", "categories")} in use. Rename one everywhere, or merge it into another.`}</p>
        </div>
        {categories.length > 8 && <SearchField value={q} onChange={setQ} placeholder="Find a category" className="w-full sm:w-56" />}
      </div>
      {lookalikes.length > 0 && (
        <div className="rounded-[var(--radius)] border border-border bg-surface-subdued p-3 text-[12.5px] text-text-secondary">
          <span className="font-medium text-text">Probably the same:</span>
          <ul className="mt-1 flex flex-col gap-1">
            {lookalikes.map((group) => {
              // Keep the spelling most items already use.
              const keep = [...group].sort((a, b) => (categories.find((c) => c.name === b)?.count ?? 0) - (categories.find((c) => c.name === a)?.count ?? 0))[0]!;
              return (
                <li key={group.join("|")} className="flex flex-wrap items-center gap-2">
                  <span>{group.map((g) => `“${g}”`).join(", ")}</span>
                  {!readOnly &&
                    group
                      .filter((g) => g !== keep)
                      .map((g) => (
                        <Button key={g} size="sm" variant="plain" icon={<Merge />} onClick={() => open(g, keep)}>
                          Merge “{g}” into “{keep}”
                        </Button>
                      ))}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {shown.length > 0 && (
        <div className="max-h-72 divide-y divide-border overflow-y-auto rounded-[var(--radius)] border border-border">
          {shown.map((c) => (
            <div key={c.name} className="flex items-center justify-between gap-3 px-3 py-1.5">
              <span className="min-w-0 truncate text-[13px] text-text" title={c.name}>
                {c.name}
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="text-[12px] tabular text-text-tertiary">{pluralize(c.count, "item")}</span>
                {!readOnly && (
                  <Button size="sm" variant="plain" icon={<Pencil />} onClick={() => open(c.name)}>
                    Rename or merge
                  </Button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        size="sm"
        title={`Rename “${target ?? ""}”`}
        subtitle={`${pluralize(count, "item")} in this category.`}
        footer={
          <>
            <Button onClick={() => setTarget(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => void apply()} loading={busy} disabled={!typed || typed === target}>
              {existing ? "Merge" : "Rename"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <Combobox
            label="New name"
            value={name}
            onChange={setName}
            onCreate={setName}
            createLabel={(v) => `Rename to “${v}”`}
            placeholder="Type a new name, or pick a category to merge into"
            options={categories.filter((c) => c.name !== target).map((c) => ({ value: c.name, label: c.name, description: pluralize(c.count, "item") }))}
          />
          <p className="text-[12.5px] text-text-secondary">
            {existing
              ? `“${existing.name}” already exists with ${pluralize(existing.count, "item")}. The two become one category with ${pluralize(existing.count + count, "item")}.`
              : "Every item in the category gets the new name. The change is logged in Activity."}
          </p>
        </div>
      </Modal>
    </SettingsCard>
  );
}
