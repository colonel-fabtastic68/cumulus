"use client";

import { useEffect, useRef, useState } from "react";
import { CalendlyEmbed } from "./CalendlyEmbed";

/** Mounts the Calendly widget only once the section is near the viewport, so the home page does not load the script up front. */
export function LazyCalendly({ url }: { url: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Deep links to #demo and browsers without the observer load the calendar at once.
  const [near, setNear] = useState(() => typeof window !== "undefined" && (!("IntersectionObserver" in window) || window.location.hash === "#demo"));
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return (
    <div ref={ref} className="min-h-[640px]">
      {near ? (
        <CalendlyEmbed url={url} />
      ) : (
        <div className="flex h-[640px] items-center justify-center rounded-[var(--radius-lg)] bg-surface text-[13px] text-text-tertiary shadow-[var(--shadow-bevel)]">Loading the calendar…</div>
      )}
    </div>
  );
}
