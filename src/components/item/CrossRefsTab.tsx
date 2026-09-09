"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import type { CrossRef, CrossRefKind, Item } from "@/lib/types";
import { updateItem } from "@/lib/inventory";
import { useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { Badge, Banner, Button, EmptyState, FormGrid, IconButton, Select, SimpleTable, TextField, useToast } from "@/components/ui";

export const CROSS_REF_KINDS: Array<{ value: CrossRefKind; label: string; hint: string }> = [
  { value: "oem", label: "OEM number", hint: "The original manufacturer's part number" },
  { value: "aftermarket", label: "Aftermarket equivalent", hint: "An interchangeable part from another maker" },
  { value: "competitor", label: "Competitor number", hint: "What a rival catalogue calls it" },
  { value: "supplier", label: "Supplier number", hint: "The number a vendor uses on quotes and invoices" },
  { value: "alias", label: "Nickname / colloquial", hint: "What counter staff and customers call it" },
];

export function crossRefKindLabel(kind: CrossRefKind): string {
  return CROSS_REF_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

/** Factor 24: every other number this part is known by, all searchable and scannable. */
export function CrossRefsTab({ item, items, canEdit }: { item: Item; items: Item[]; canEdit: boolean }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const [number, setNumber] = useState("");
  const [kind, setKind] = useState<CrossRefKind>("oem");
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const refs = item.crossRefs ?? [];
  const supersededBy = item.supersededBy ? items.find((i) => i.id === item.supersededBy) : undefined;
  const supersedes = useMemo(() => items.filter((i) => i.supersededBy === item.id), [items, item.id]);

  const save = async (next: CrossRef[], message: string) => {
    setBusy(true);
    try {
      await updateItem(store, user, item.id, { crossRefs: next }, "Cross-references updated");
      toast(message, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "critical");
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const n = number.trim();
    if (!n) return;
    if (refs.some((r) => r.number.toLowerCase() === n.toLowerCase())) return toast(`${n} is already listed`, "critical");
    const clash = items.find((i) => i.id !== item.id && (i.sku.toLowerCase() === n.toLowerCase() || i.crossRefs?.some((r) => r.number.toLowerCase() === n.toLowerCase())));
    await save([...refs, { number: n, kind, source: source.trim() || undefined, note: note.trim() || undefined }], clash ? `Added ${n}. Note: ${clash.sku} also answers to that number.` : `Added ${n}`);
    setNumber("");
    setSource("");
    setNote("");
  };

  const remove = (ref: CrossRef) => save(refs.filter((r) => r !== ref), `Removed ${ref.number}`);

  return (
    <div className="flex flex-col gap-4">
      {(supersededBy || supersedes.length > 0) && (
        <Banner tone="info" title="Part number history">
          {supersededBy && (
            <span>
              Superseded by{" "}
              <Link href={`/inventory/${supersededBy.id}`} className="font-mono text-accent hover:underline">
                {supersededBy.sku}
              </Link>
              .{" "}
            </span>
          )}
          {supersedes.length > 0 && (
            <span>
              Replaces{" "}
              {supersedes.map((s, i) => (
                <span key={s.id}>
                  {i > 0 && ", "}
                  <Link href={`/inventory/${s.id}`} className="font-mono text-accent hover:underline">
                    {s.sku}
                  </Link>
                </span>
              ))}
              . Searching or scanning the old number finds this part.
            </span>
          )}
        </Banner>
      )}

      {refs.length === 0 ? (
        <EmptyState title="No cross-references yet" description="Add the OEM number, competitor and supplier numbers, or the name people use at the counter. Searching or scanning any of them lands here." />
      ) : (
        <SimpleTable>
          <thead>
            <tr>
              <th>Number</th>
              <th>Kind</th>
              <th>Whose</th>
              <th>Note</th>
              {canEdit && <th className="w-10" />}
            </tr>
          </thead>
          <tbody>
            {refs.map((r) => (
              <tr key={`${r.kind}-${r.number}`}>
                <td className="font-mono text-[12.5px] text-text">{r.number}</td>
                <td>
                  <Badge tone={r.kind === "oem" ? "info" : r.kind === "alias" ? "attention" : "default"}>{crossRefKindLabel(r.kind)}</Badge>
                </td>
                <td className="text-text-secondary">{r.source ?? "—"}</td>
                <td className="max-w-[280px] truncate text-text-secondary">{r.note ?? "—"}</td>
                {canEdit && (
                  <td className="text-right">
                    <IconButton size="sm" variant="plain" aria-label={`Remove ${r.number}`} icon={<Trash2 />} className="text-text-tertiary hover:text-critical" onClick={() => void remove(r)} disabled={busy} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </SimpleTable>
      )}

      {canEdit && (
        <form
          className="rounded-[var(--radius)] border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <FormGrid cols={4}>
            <TextField label="Number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="1590B-BLK" autoComplete="off" />
            <Select label="Kind" value={kind} onChange={(e) => setKind(e.target.value as CrossRefKind)} options={CROSS_REF_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
            <TextField label="Whose" hint="(optional)" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Hammond, Mouser, a competitor" />
            <TextField label="Note" hint="(optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          </FormGrid>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[12px] text-text-tertiary">{CROSS_REF_KINDS.find((k) => k.value === kind)?.hint}</span>
            <Button type="submit" size="sm" variant="primary" icon={<Plus />} loading={busy} disabled={!number.trim()}>
              Add cross-reference
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
