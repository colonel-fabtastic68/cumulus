"use client";

import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Banner } from "@/components/ui";

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect(source: ImageBitmapSource): Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code", "data_matrix"];

/**
 * Reads barcodes from the device camera. Uses the browser's BarcodeDetector
 * where it exists (Chrome, Edge, Android) and falls back to ZXing elsewhere
 * (Safari, Firefox). Calls onScan once per distinct code with a short cooldown.
 */
export function CameraScanner({ onScan, active = true }: { onScan: (code: string) => void; active?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<"native" | "zxing" | null>(null);
  const handler = useRef(onScan);
  useEffect(() => {
    handler.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!active) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopZxing: (() => void) | null = null;
    let lastCode = "";
    let lastAt = 0;
    const emit = (code: string) => {
      const now = Date.now();
      if (code === lastCode && now - lastAt < 2500) return;
      lastCode = code;
      lastAt = now;
      handler.current(code);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (cancelled) return;
        video.srcObject = stream;
        await video.play();
        const Detector = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
        if (Detector) {
          setEngine("native");
          const detector = new Detector({ formats: FORMATS });
          const tick = async () => {
            if (cancelled) return;
            try {
              if (video.readyState >= 2) {
                const codes = await detector.detect(video);
                for (const c of codes) if (c.rawValue) emit(c.rawValue);
              }
            } catch {
              // A frame failed to decode; keep going.
            }
            raf = window.setTimeout(tick, 120) as unknown as number;
          };
          void tick();
        } else {
          setEngine("zxing");
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          if (cancelled) return;
          const reader = new BrowserMultiFormatReader();
          const controls = await reader.decodeFromVideoElement(video, (result) => {
            if (result) emit(result.getText());
          });
          stopZxing = () => controls.stop();
        }
      } catch (e) {
        if (cancelled) return;
        const name = (e as { name?: string })?.name ?? "";
        setError(name === "NotAllowedError" ? "Camera access was blocked. Allow the camera for this site, or use a keyboard scanner." : name === "NotFoundError" ? "No camera was found on this device." : e instanceof Error ? e.message : "Could not start the camera.");
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(raf);
      stopZxing?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [active]);

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-[var(--radius)] bg-black">
        <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-1/3 w-2/3 rounded-[10px] border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
        </div>
        {!error && !engine && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-[13px] text-white">
            <Camera className="h-4 w-4" /> Starting camera…
          </div>
        )}
      </div>
      {error && <Banner tone="warning">{error}</Banner>}
      {engine && <p className="text-[12px] text-text-tertiary">Hold the code inside the frame. {engine === "native" ? "Using the browser's barcode detector." : "Using the ZXing decoder."}</p>}
    </div>
  );
}
