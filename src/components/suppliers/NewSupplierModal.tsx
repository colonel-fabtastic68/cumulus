"use client";

import { useState } from "react";
import type { Supplier } from "@/lib/types";
import { upsertSupplier } from "@/lib/inventory";
import { useCollection, useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { Button, Modal, useToast } from "@/components/ui";
import { SupplierFields } from "./SupplierFields";
import { draftFromSupplier, draftToInput, validateDraft, type SupplierDraft } from "./supplierUtils";

interface NewSupplierModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (supplier: Supplier) => void;
}

/** Mounts the form only while open so every opening starts from a clean state. */
export function NewSupplierModal(props: NewSupplierModalProps) {
  if (!props.open) return null;
  return <NewSupplierForm {...props} />;
}

function NewSupplierForm({ open, onClose, onCreated }: NewSupplierModalProps) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const suppliers = useCollection("suppliers");
  const [draft, setDraft] = useState<SupplierDraft>(() => draftFromSupplier());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const problem = validateDraft(draft);
    if (problem) return setError(problem);
    const name = draft.name.trim().toLowerCase();
    if (suppliers.some((s) => s.name.trim().toLowerCase() === name)) return setError(`A supplier named ${draft.name.trim()} already exists`);
    setBusy(true);
    setError(null);
    try {
      const supplier = await upsertSupplier(store, user, draftToInput(draft));
      toast(`Added ${supplier.name}`, "success");
      onCreated?.(supplier);
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
      title="New supplier"
      subtitle="Assign the supplier on items afterwards to track lead times and reorders."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!draft.name.trim()}>
            Create supplier
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <SupplierFields draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} autoFocus />
        {error && <p className="text-[12.5px] text-critical">{error}</p>}
      </div>
    </Modal>
  );
}
