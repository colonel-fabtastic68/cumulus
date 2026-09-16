"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    Calendly?: {
      initInlineWidget: (opts: { url: string; parentElement: HTMLElement; prefill?: Record<string, unknown>; utm?: Record<string, unknown>; resize?: boolean }) => void;
    };
  }
}

const SCRIPT_SRC = "https://assets.calendly.com/assets/external/widget.js";

/**
 * Calendly's inline scheduling widget. The script is fetched on demand so the
 * page renders without it, and a plain link is offered if it cannot load.
 */
export function CalendlyEmbed({ url, className }: { url: string; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const start = () => {
      if (cancelled || !window.Calendly || !host.current) return;
      host.current.innerHTML = "";
      window.Calendly.initInlineWidget({ url, parentElement: host.current, prefill: {}, utm: {}, resize: true });
    };
    if (window.Calendly) {
      start();
      return () => {
        cancelled = true;
      };
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    const script = existing ?? document.createElement("script");
    const onError = () => setFailed(true);
    script.addEventListener("load", start);
    script.addEventListener("error", onError);
    if (!existing) {
      script.src = SCRIPT_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
      script.removeEventListener("load", start);
      script.removeEventListener("error", onError);
    };
  }, [url]);

  return (
    <div className={className}>
      <div ref={host} className="min-h-[640px] w-full" />
      {failed && (
        <p className="mt-3 text-[13px] text-text-secondary">
          The calendar could not load.{" "}
          <a href={url} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
            Open it on Calendly
          </a>
          .
        </p>
      )}
    </div>
  );
}
