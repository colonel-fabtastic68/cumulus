"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import type { Supplier } from "@/lib/types";
import { bulkPatchItems, upsertSupplier } from "@/lib/inventory";
import { useDoc, useItems, useSettings, useStore } from "@/lib/store/provider";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { useAgent } from "@/components/agent/AgentProvider";
import { formatDate, formatMoney, formatNumber, pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button, ConfirmDialog, Drawer, IconButton, useToast } from "@/components/ui";
import { SupplierFields } from "./SupplierFields";
import { SupplierItemsTable } from "./SupplierItemsTable";
import { draftFromSupplier, draftToInput, isDraftDirty, reorderEmailPrompt, supplierStats, validateDraft, websiteHref, websiteLabel, type SupplierDraft } from "./supplierUtils";

interface SupplierDrawerProps {
  supplierId: string | null;
  onClose: () => void;
}

/** Slide-over for one supplier. Remounts per supplier so form state never leaks between records. */
export function SupplierDrawer({ supplierId, onClose }: SupplierDrawerProps) {
  const supplier = useDoc("suppliers", supplierId ?? undefined);
  if (!supplier) return null;
  return <SupplierDrawerInner key={supplier.id} supplier={supplier} onClose={onClose} />;
}

function SupplierDrawerInner({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const items = useItems();
  const settings = useSettings();
  const { open: openAgent } = useAgent();
  const writable = canWrite(user);

  const saved = useMemo(() => draftFromSupplier(supplier), [supplier]);
  const [draft, setDraft] = useState<SupplierDraft>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const stats = useMemo(() => supplierStats(items, supplier.id), [items, supplier.id]);
  const dirty = isDraftDirty(draft, saved);

  const save = async () => {
    const problem = validateDraft(draft);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const next = await upsertSupplier(store, user, { ...draftToInput(draft), id: supplier.id, createdAt: supplier.createdAt });
      toast(`Saved ${next.name}`, "success");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      if (stats.items.length > 0) {
        await bulkPatchItems(
          store,
          user,
          stats.items.map((i) => ({ id: i.id, patch: { supplierId: undefined } })),
          `${supplier.name} deleted`,
        );
      }
      await store.remove("suppliers", supplier.id);
      toast(`Deleted ${supplier.name}${stats.items.length ? ` · ${pluralize(stats.items.length, "item")} unassigned` : ""}`, "success");
      setConfirmDelete(false);
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "critical");
      setBusy(false);
    }
  };

  const draftEmail = () => openAgent(reorderEmailPrompt(supplier, stats, settings, user), { send: true });

  const tiles = [
    { label: "Items supplied", value: formatNumber(stats.items.length) },
    { label: "Below minimum", value: formatNumber(stats.lowItems.length), tone: stats.lowItems.length > 0 ? "text-warning" : undefined },
    { label: "Stock value", value: formatMoney(stats.value, settings.currency) },
  ];

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        width={560}
        title={supplier.name}
        subtitle={[supplier.terms, `Added ${formatDate(supplier.createdAt)}`].filter(Boolean).join(" · ")}
        headerActions={
          supplier.website ? (
            <IconButton variant="plain" size="sm" className="text-text-secondary" aria-label={`Open ${websiteLabel(supplier.website)}`} title={websiteLabel(supplier.website)} onClick={() => window.open(websiteHref(supplier.website!), "_blank", "noopener")}>
              <ExternalLink className="h-4 w-4" />
            </IconButton>
          ) : undefined
        }
        footer={
          writable ? (
            <>
              <Button variant="plain" className="mr-auto text-critical hover:bg-critical-soft" icon={<Trash2 />} onClick={() => setConfirmDelete(true)} disabled={busy}>
                Delete supplier
              </Button>
              <Button onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" onClick={save} loading={busy && !confirmDelete} disabled={!dirty || busy}>
                Save changes
              </Button>
            </>
          ) : (
            <Button onClick={onClose}>Close</Button>
          )
        }
      >
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-3 gap-2">
            {tiles.map((t) => (
              <div key={t.label} className="rounded-[var(--radius)] border border-border px-3 py-2">
                <div className="text-[11.5px] font-medium text-text-secondary">{t.label}</div>
                <div className={cn("mt-0.5 text-[15px] font-semibold tabular", t.tone)}>{t.value}</div>
              </div>
            ))}
          </div>

          <div>
            <h3 className="mb-2 text-[13.5px] font-semibold text-text">Details</h3>
            <SupplierFields draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} disabled={!writable || busy} />
            {error && <p className="mt-2 text-[12.5px] text-critical">{error}</p>}
            {!writable && <p className="mt-2 text-[12px] text-text-tertiary">Viewers can see suppliers but can&apos;t edit them.</p>}
          </div>

          <SupplierItemsTable supplier={supplier} stats={stats} currency={settings.currency} onDraftEmail={draftEmail} />
        </div>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        title={`Delete ${supplier.name}?`}
        confirmLabel="Delete supplier"
        destructive
        loading={busy}
        message={
          stats.items.length > 0 ? (
            <p>
              {pluralize(stats.items.length, "item")} {stats.items.length === 1 ? "names" : "name"} this supplier. {stats.items.length === 1 ? "It" : "They"} will be kept, but will no longer have a supplier assigned. Receipts already recorded are not
              changed.
            </p>
          ) : (
            <p>No items reference this supplier. This can&apos;t be undone.</p>
          )
        }
      />
    </>
  );
}
