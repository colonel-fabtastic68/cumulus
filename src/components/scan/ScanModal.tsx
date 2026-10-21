"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Segmented } from "@/components/ui";
import { useCollection, useItems } from "@/lib/store/provider";
import { resolveScan, type LabelData, type ScanResolution } from "@/lib/labels/entries";
import { CameraScanner } from "./CameraScanner";
import { ScanField } from "./ScanField";
import { ScanResultCard } from "./ScanResult";

type Mode = "camera" | "keyboard";

/**
 * Factor 32: scan anything, anywhere. Finds the item, batch, location or
 * supplier behind a barcode, SKU, cross-reference or printed QR link and
 * offers the next step. Opened from the top bar or ⌘/.
 */
export function ScanModal({ open, onClose, initialCode }: { open: boolean; onClose: () => void; initialCode?: string }) {
  if (!open) return null;
  return <ScanBody onClose={onClose} initialCode={initialCode} />;
}

function ScanBody({ onClose, initialCode }: { onClose: () => void; initialCode?: string }) {
  const items = useItems();
  const locations = useCollection("locations");
  const suppliers = useCollection("suppliers");
  const lots = useCollection("lots");
  const router = useRouter();
  const data = useMemo<LabelData>(() => ({ items, locations, suppliers, lots }), [items, locations, suppliers, lots]);
  const [mode, setMode] = useState<Mode>(() => (typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia ? "camera" : "keyboard"));
  const [last, setLast] = useState<{ code: string; result: ScanResolution | null } | null>(() => (initialCode ? { code: initialCode, result: resolveScan(initialCode, data) } : null));

  const handle = (code: string) => setLast({ code, result: resolveScan(code, data) });
  const go = (href: string) => {
    router.push(href);
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Scan" subtitle="Barcodes, SKUs, lot numbers, location codes and printed QR labels all work" size="md">
      <div className="flex flex-col gap-4">
        <Segmented<Mode> value={mode} onChange={setMode} options={[{ value: "camera", label: "Camera" }, { value: "keyboard", label: "Scanner or keyboard" }]} />
        {mode === "camera" ? <CameraScanner onScan={handle} /> : <ScanField onScan={handle} autoFocus label="Scan a code" help="Point a USB or Bluetooth scanner here, or type the number and press Enter." />}
        {last && <ScanResultCard code={last.code} result={last.result} onGo={go} />}
      </div>
    </Modal>
  );
}
