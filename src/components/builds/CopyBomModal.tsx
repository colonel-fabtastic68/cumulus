"use client";

import { useState } from "react";
import { FilePlus2 } from "lucide-react";
import type { Item } from "@/lib/types";
import { Banner, Button, Modal, TextField, useToast } from "@/components/ui";
import { useCurrentUser } from "@/lib/auth";
import { createItems } from "@/lib/inventory";
import { useStore } from "@/lib/store/provider";
import { pluralize } from "@/lib/format";

/** Duplicate an assembly: a new item that starts with the same BOM (and category, unit, cost, price, supplier). Edit the line that differs afterwards. */
export function CopyBomModal({ source, onClose, onDone }: { source: Item | null; onClose: () => void; onDone?: (target: Item) => void }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!source) return null;
  const lines = source.bom.length;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!sku.trim() || !name.trim()) return setError("Give the new assembly a SKU and a name.");
      const [created] = await createItems(store, user, [{ ...copyableFields(source), sku: sku.trim().toUpperCase(), name: name.trim(), type: "assembly", bom: source.bom.map((l) => ({ ...l })) }]);
      toast(`Created ${created!.sku} with ${pluralize(lines, "line")}`, "success");
      onDone?.(created!);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={`Copy BOM from ${source.sku}`}
      subtitle={`${pluralize(lines, "line")} · ${source.name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<FilePlus2 />} onClick={() => void run()} loading={busy} disabled={!sku.trim() || !name.trim()}>
            Create assembly
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="New SKU" value={sku} onChange={(e) => setSku(e.target.value)} placeholder={`${source.sku}-V2`} autoFocus />
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${source.name} (variant)`} />
          <p className="text-[12.5px] text-text-secondary sm:col-span-2">Every BOM line is copied, along with category, unit, cost, price and supplier; stock starts at zero.</p>
        </div>
        {error && <Banner tone="critical">{error}</Banner>}
      </div>
    </Modal>
  );
}

function copyableFields(i: Item): Partial<Item> {
  return { category: i.category, unit: i.unit, unitCost: i.unitCost, price: i.price, supplierId: i.supplierId, tags: [...i.tags], description: i.description, color: i.color };
}
