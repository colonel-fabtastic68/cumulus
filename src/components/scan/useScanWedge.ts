"use client";

import { useEffect, useRef } from "react";
import { normalizeCode } from "@/lib/scan";

/**
 * Keyboard-wedge scanners type the code fast and press Enter. When nothing
 * editable has focus, collect those keystrokes and hand the code over.
 */
export function useScanWedge(onScan: (code: string) => void, opts: { enabled?: boolean; minLength?: number; maxGapMs?: number } = {}) {
  const { enabled = true, minLength = 4, maxGapMs = 60 } = opts;
  const handler = useRef(onScan);
  useEffect(() => {
    handler.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;
    let buffer = "";
    let last = 0;
    let timer = 0;
    const reset = () => {
      buffer = "";
      window.clearTimeout(timer);
    };
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.closest("[role='dialog']"))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const now = performance.now();
      if (now - last > maxGapMs) buffer = "";
      last = now;
      if (e.key === "Enter") {
        const code = normalizeCode(buffer);
        reset();
        if (code.length >= minLength) {
          e.preventDefault();
          handler.current(code);
        }
        return;
      }
      if (e.key.length === 1) {
        buffer += e.key;
        window.clearTimeout(timer);
        timer = window.setTimeout(reset, 250);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
  }, [enabled, minLength, maxGapMs]);
}
