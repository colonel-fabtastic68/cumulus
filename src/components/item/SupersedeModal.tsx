"use client";

import { useState } from "react";
import type { Item } from "@/lib/types";
import { deactivateItems } from "@/lib/inventory";
import { useStore } from "@/lib/store/provider";
import { useCurrentUser } from "@/lib/auth";
import { Button, Modal, TextField, useToast } from "@/components/ui";
import { ItemPicker } from "@/components/inventory";
import { errorMessage } from "./utils";

interface Props {
  open: boolean;
  onClose: () => void;
  item: Item;
}

/** Mark an item as superseded by a replacement part number. */
export function SupersedeModal(props: Props) {
  if (!props.open) return null;
  return <SupersedeForm {...props} />;
}

function SupersedeForm({ onClose, item }: Props) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const [replacement, setReplacement] = useState<Item | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!replacement) return;
    setBusy(true);
    try {
      await deactivateItems(store, user, [item.id], { supersededBy: replacement.id, reason: reason.trim() || `Superseded by ${replacement.sku}` });
      toast(`${item.sku} superseded by ${replacement.sku}`, "success");
      onClose();
    } catch (e) {
      toast(errorMessage(e), "critical");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Supersede ${item.sku}`}
      subtitle="The old part number stays in history and reports, but drops out of active inventory. Remaining stock is still usable."
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!replacement}>
            Supersede
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <ItemPicker label="Replacement part" value={replacement} onChange={setReplacement} exclude={[item.id]} filter={(i) => i.status === "active"} autoFocus />
        <TextField label="Reason" hint="(optional)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Rev 3 board replaces rev 2" />
      </div>
    </Modal>
  );
}
