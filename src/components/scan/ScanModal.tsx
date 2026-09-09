"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Camera, Keyboard, PackageCheck, SlidersHorizontal } from "lucide-react";
import type { Item } from "@/lib/types";
import { Badge, Banner, Button, Modal, Segmented } from "@/components/ui";
import { useItems } from "@/lib/store/provider";
import { findItemByCode, type CodeMatch } from "@/lib/scan";
import { formatQty } from "@/lib/format";
import { CameraScanner } from "./CameraScanner";
import { ScanField } from "./ScanField";

type Mode = "camera" | "keyboard";

const MATCH_LABEL: Record<CodeMatch["matchedBy"], string> = { barcode: "Barcode", sku: "SKU", crossRef: "Cross-reference", channel: "Channel id" };

/**
 * Factor 32: scan anything, anywhere. Finds the item behind a barcode, SKU or
 * cross-reference and offers the next step. Opened from the top bar or ⌘/.
 */
export function ScanModal({ open, onClose, initialCode }: { open: boolean; onClose: () => void; initialCode?: string }) {
  if (!open) return null;
  return <ScanBody onClose={onClose} initialCode={initialCode} />;
}

function ScanBody({ onClose, initialCode }: { onClose: () => void; initialCode?: string }) {
  const items = useItems();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(() => (typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia ? "camera" : "keyboard"));
  const [last, setLast] = useState<{ code: string; match: CodeMatch | null } | null>(() => (initialCode ? { code: initialCode, match: findItemByCode(items, initialCode) } : null));

  const handle = (code: string) => setLast({ code, match: findItemByCode(items, code) });
  const go = (href: string) => {
    router.push(href);
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Scan" subtitle="Barcodes, SKUs and cross-reference numbers all work" size="md">
      <div className="flex flex-col gap-4">
        <Segmented<Mode> value={mode} onChange={setMode} options={[{ value: "camera", label: "Camera" }, { value: "keyboard", label: "Scanner or keyboard" }]} />
        {mode === "camera" ? <CameraScanner onScan={handle} /> : <ScanField onScan={handle} autoFocus label="Scan a code" help="Point a USB or Bluetooth scanner here, or type the number and press Enter." />}

        {last && (
          <div className="rounded-[var(--radius)] border border-border p-3">
            <div className="text-[12px] text-text-tertiary">
              Scanned <span className="font-mono text-text">{last.code}</span>
            </div>
            {last.match ? <MatchCard match={last.match} onOpen={(item) => go(`/inventory/${item.id}`)} onReceive={(item) => go(`/receiving?scan=${encodeURIComponent(item.sku)}`)} onCount={(item) => go(`/inventory?adjust=${encodeURIComponent(item.id)}`)} /> : (
              <Banner tone="warning" className="mt-2" title="No item matches that code">
                Add the barcode to the item, or add it as a cross-reference on the item&apos;s Cross-references tab, and it will scan next time.
              </Banner>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function MatchCard({ match, onOpen, onReceive, onCount }: { match: CodeMatch; onOpen: (item: Item) => void; onReceive: (item: Item) => void; onCount: (item: Item) => void }) {
  const { item } = match;
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[12.5px] text-text">{item.sku}</span>
        <span className="text-[13px] text-text">{item.name}</span>
        <Badge tone="info">{MATCH_LABEL[match.matchedBy]}{match.ref?.source ? ` · ${match.ref.source}` : ""}</Badge>
      </div>
      <div className="mt-1 text-[12.5px] text-text-secondary">
        {formatQty(item.onHand, item.unit)} on hand{item.location ? ` · bin ${item.location}` : ""}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" iconRight={<ArrowRight />} onClick={() => onOpen(item)}>
          Open item
        </Button>
        <Button size="sm" icon={<PackageCheck />} onClick={() => onReceive(item)}>
          Receive
        </Button>
        <Button size="sm" icon={<SlidersHorizontal />} onClick={() => onCount(item)}>
          Count / adjust
        </Button>
      </div>
      <p className="mt-2 flex items-center gap-1 text-[11.5px] text-text-tertiary">
        <Keyboard className="h-3 w-3" /> Keep scanning to look up another code.
      </p>
      <span className="hidden">
        <Camera />
      </span>
    </div>
  );
}
