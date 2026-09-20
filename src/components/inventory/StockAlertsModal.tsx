"use client";

import { useState } from "react";
import type { StockAlertRule } from "@/lib/types";
import { Button, Modal, useToast } from "@/components/ui";
import { DEFAULT_STOCK_ALERTS } from "@/lib/inventory";
import { useSettings } from "@/lib/store/provider";
import { StockAlertsForm, useSaveSettings } from "@/components/workspace/settings";

/** Quick access to the low-stock rule from the Inventory page; the same setting lives under Settings → Inventory policy. */
export function StockAlertsModal({ open, onClose, canEdit }: { open: boolean; onClose: () => void; canEdit: boolean }) {
  if (!open) return null;
  return <Form onClose={onClose} canEdit={canEdit} />;
}

function Form({ onClose, canEdit }: { onClose: () => void; canEdit: boolean }) {
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const toast = useToast();
  const [rule, setRule] = useState<StockAlertRule>(settings.stockAlerts ?? DEFAULT_STOCK_ALERTS);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await saveSettings({ stockAlerts: rule });
      toast("Stock alert rule saved", "success");
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not save", "critical");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Stock alerts"
      subtitle="What the Low chip, the low-stock view and reorder suggestions go by. Also under Settings → Inventory policy."
      footer={
        <>
          <Button onClick={onClose}>{canEdit ? "Cancel" : "Close"}</Button>
          {canEdit && (
            <Button variant="primary" onClick={() => void save()} loading={saving}>
              Save
            </Button>
          )}
        </>
      }
    >
      <StockAlertsForm value={rule} onChange={setRule} disabled={!canEdit} />
    </Modal>
  );
}
