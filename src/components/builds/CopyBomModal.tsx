"use client";

import { useState } from "react";
import { Copy, FilePlus2 } from "lucide-react";
import type { Item } from "@/lib/types";
import { Banner, Button, Modal, Segmented, TextField, useToast } from "@/components/ui";
import { ItemPicker } from "@/components/inventory";
import { useCurrentUser } from "@/lib/auth";
import { createItems, updateItem } from "@/lib/inventory";
import { useStore } from "@/lib/store/provider";
import { pluralize } from "@/lib/format";

/** Reuse a BOM: paste it onto an existing item, or make a new assembly that starts as a copy. Edit the one line that differs afterwards. */
export function CopyBomModal({ source, onClose, onDone }: { source: Item | null; onClose: () => void; onDone?: (target: Item) => void }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [target, setTarget] = useState<Item | null>(null);
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
      if (mode === "existing") {
        if (!target) return setError("Pick the item to copy onto.");
        await updateItem(store, user, target.id, { bom: source.bom.map((l) => ({ ...l })), type: "assembly" }, `Copied BOM from ${source.sku}`);
        toast(`Copied ${pluralize(lines, "line")} onto ${target.sku}`, "success");
        onDone?.(target);
      } else {
        if (!sku.trim() || !name.trim()) return setError("Give the new assembly a SKU and a name.");
        const [created] = await createItems(store, user, [{ ...copyableFields(source), sku: sku.trim().toUpperCase(), name: name.trim(), type: "assembly", bom: source.bom.map((l) => ({ ...l })) }]);
        toast(`Created ${created!.sku} with ${pluralize(lines, "line")}`, "success");
        onDone?.(created!);
      }
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
          <Button variant="primary" icon={mode === "new" ? <FilePlus2 /> : <Copy />} onClick={() => void run()} loading={busy} disabled={mode === "existing" ? !target : !sku.trim() || !name.trim()}>
            {mode === "new" ? "Create assembly" : "Copy BOM"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented value={mode} onChange={setMode} options={[{ value: "new", label: "New assembly from this BOM" }, { value: "existing", label: "Onto an existing item" }]} />
        {mode === "new" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextField label="New SKU" value={sku} onChange={(e) => setSku(e.target.value)} placeholder={`${source.sku}-V2`} autoFocus />
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${source.name} (variant)`} />
            <p className="text-[12.5px] text-text-secondary sm:col-span-2">Category, unit, cost, price and supplier are copied too; stock starts at zero.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <ItemPicker label="Copy onto" value={target} onChange={setTarget} exclude={[source.id]} filter={(i) => i.status === "active"} autoFocus />
            {target && target.bom.length > 0 && (
              <Banner tone="warning">
                {target.sku} already has {pluralize(target.bom.length, "BOM line")}; they will be replaced.
              </Banner>
            )}
            <p className="text-[12.5px] text-text-secondary">A part becomes an assembly when it receives a BOM.</p>
          </div>
        )}
        {error && <Banner tone="critical">{error}</Banner>}
      </div>
    </Modal>
  );
}

function copyableFields(i: Item): Partial<Item> {
  return { category: i.category, unit: i.unit, unitCost: i.unitCost, price: i.price, supplierId: i.supplierId, tags: [...i.tags], description: i.description, color: i.color };
}
