"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { QrCode } from "lucide-react";
import { Button, Page, QueryParamEffect, Segmented } from "@/components/ui";
import { useAgent } from "@/components/agent/AgentProvider";
import { resolveScan, type LabelData, type ScanResolution } from "@/lib/labels/entries";
import { useCollection, useItems } from "@/lib/store/provider";
import { CameraScanner } from "./CameraScanner";
import { ScanField } from "./ScanField";
import { ScanResultCard } from "./ScanResult";

type Mode = "camera" | "keyboard";

/**
 * /scan: where a QR label sends a phone. With ?c=sku:ABC the record opens
 * straight away; without it, the page is a full-screen scanner for walking
 * the shelves with a phone.
 */
export function ScanPage() {
  const items = useItems();
  const locations = useCollection("locations");
  const suppliers = useCollection("suppliers");
  const lots = useCollection("lots");
  const router = useRouter();
  const { setPageContext } = useAgent();
  const [mode, setMode] = useState<Mode>(() => (typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia ? "camera" : "keyboard"));
  const [last, setLast] = useState<{ code: string; result: ScanResolution | null } | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    setPageContext({ page: "Scan" });
  }, [setPageContext]);

  const data = useMemo<LabelData>(() => ({ items, locations, suppliers, lots }), [items, locations, suppliers, lots]);
  const handle = useCallback((code: string) => setLast({ code, result: resolveScan(code, data) }), [data]);

  // A code in the address bar (from a printed QR) opens its record as soon as the workspace has loaded.
  const onParam = useCallback((c: string) => setPending(c), []);
  const pendingResult = useMemo(() => (pending ? resolveScan(pending, data) : null), [pending, data]);
  useEffect(() => {
    if (pendingResult) router.replace(pendingResult.href);
  }, [pendingResult, router]);
  // Until something else is scanned, an unmatched code from the address bar is what the card shows.
  const shown = last ?? (pending && !pendingResult && (items.length || locations.length) ? { code: pending, result: null } : null);

  return (
    <Page title="Scan" subtitle="Point the camera at a label, or type the code. Items, batches, locations and suppliers all open from here." narrow>
      <Suspense fallback={null}>
        <QueryParamEffect param="c" onValue={onParam} />
      </Suspense>
      <div className="flex flex-col gap-4">
        <Segmented<Mode> value={mode} onChange={setMode} options={[{ value: "camera", label: "Camera" }, { value: "keyboard", label: "Scanner or keyboard" }]} />
        {mode === "camera" ? <CameraScanner onScan={handle} /> : <ScanField onScan={handle} autoFocus label="Scan a code" help="Point a USB or Bluetooth scanner here, or type the number and press Enter." />}
        {shown && <ScanResultCard code={shown.code} result={shown.result} onGo={(href) => router.push(href)} />}
        <div className="flex justify-end">
          <Button variant="plain" icon={<QrCode />} href="/exports/labels">
            Print labels
          </Button>
        </div>
      </div>
    </Page>
  );
}
