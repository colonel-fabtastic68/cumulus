"use client";

import { useEffect, useState } from "react";
import type { Item } from "@/lib/types";
import { formatMoney } from "@/lib/format";
import { barcodeSvg } from "@/lib/labels/render";
import { isTwoD, type Symbology } from "@/lib/labels/spec";
import { codeDrawing, codeEntry, type CodeChoice } from "@/lib/savedCodes";
import { cn } from "@/lib/utils";

/** Codes already drawn in this tab, so a list that re-renders does not draw them again. An empty string is a code that could not be drawn. */
const drawn = new Map<string, string>();

/** The code as an SVG, or null while it is being drawn. */
export function useCodeSvg(symbology: Symbology, text: string): string | null {
  const key = `${symbology}|${text}`;
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    if (drawn.has(key)) return;
    let stale = false;
    const finish = (svg: string) => {
      drawn.set(key, svg);
      if (!stale) setDone(key);
    };
    barcodeSvg(symbology, text).then(finish, () => finish(""));
    return () => {
      stale = true;
    };
  }, [key, symbology, text]);
  // `done` only exists to render again once the drawing lands in the cache.
  return drawn.get(key) ?? (done === key ? "" : null);
}

/** The address a link code opens. The workspace only renders in the browser, so the origin is known on first render. */
export function useOrigin(): string {
  const [origin] = useState(() => (typeof window !== "undefined" ? window.location.origin : "https://app.cumulusos.com"));
  return origin;
}

/** Just the code, filling its box: a square for QR and Data Matrix, a strip for bars. */
export function CodeArt({ item, code, origin, className }: { item: Item; code: CodeChoice; origin: string; className?: string }) {
  const { text, symbology } = codeDrawing(item, code, origin);
  const svg = useCodeSvg(symbology, text);
  if (svg === "") return <div className={cn("flex items-center justify-center text-[11px] text-text-tertiary", className)}>Cannot be drawn</div>;
  return <div className={className} aria-label={`${isTwoD(symbology) ? "Code" : "Barcode"} for ${item.sku}`} role="img" dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />;
}

/** The small code at the start of a list row. */
export function CodeThumb({ item, code, origin }: { item: Item; code: CodeChoice; origin: string }) {
  const twoD = isTwoD(code.symbology);
  return (
    <div className="flex h-9 w-[68px] items-center justify-center rounded-[var(--radius-sm)] border border-border bg-white px-1.5 py-1">
      <CodeArt item={item} code={code} origin={origin} className={twoD ? "h-7 w-7" : "h-6 w-full"} />
    </div>
  );
}

/**
 * The code as it prints on a label: the code with its text beside it (square codes) or under it (bars).
 * The real size is set by the label stock chosen when printing; this shows what is on it.
 */
export function LabelPreview({ item, code, origin, currency, supplierName, size = "md", className }: { item: Item; code: CodeChoice; origin: string; currency: string; supplierName?: (id: string) => string | undefined; size?: "sm" | "md" | "lg"; className?: string }) {
  const entry = codeEntry(item, code, supplierName);
  const twoD = isTwoD(code.symbology);
  const scale = (code.textScale ?? 1) * { sm: 0.82, md: 1, lg: 1.2 }[size];
  const px = (n: number) => `${(n * scale).toFixed(1)}px`;
  const lines = (
    <>
      {code.fields.name && (
        <div className="line-clamp-2 font-semibold leading-tight text-[#111]" style={{ fontSize: px(14) }}>
          {entry.title}
        </div>
      )}
      {code.fields.code && (
        <div className="truncate font-mono leading-tight text-[#111]" style={{ fontSize: px(11.5) }}>
          {entry.subtitle ?? entry.code}
        </div>
      )}
      {code.fields.detail && entry.detail && (
        <div className="truncate leading-tight text-[#444]" style={{ fontSize: px(10.5) }}>
          {entry.detail}
        </div>
      )}
      {code.fields.price && entry.price !== undefined && (
        <div className="font-semibold leading-tight text-[#111]" style={{ fontSize: px(13.5) }}>
          {formatMoney(entry.price, currency)}
        </div>
      )}
    </>
  );
  const hasText = code.fields.name || code.fields.code || (code.fields.detail && !!entry.detail) || (code.fields.price && entry.price !== undefined);
  const box = { sm: "h-[92px]", md: "h-[124px]", lg: "h-[168px]" }[size];
  return (
    <div className={cn("flex w-full overflow-hidden rounded-[var(--radius)] border border-border bg-white", box, twoD ? "items-center gap-3 p-3" : "flex-col items-stretch gap-1.5 p-3", className)}>
      {twoD ? (
        <>
          <CodeArt item={item} code={code} origin={origin} className="aspect-square h-full shrink-0" />
          {hasText && <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">{lines}</div>}
        </>
      ) : (
        <>
          <CodeArt item={item} code={code} origin={origin} className="min-h-0 w-full flex-1" />
          {hasText && <div className="flex shrink-0 flex-col items-center gap-0.5 text-center">{lines}</div>}
        </>
      )}
    </div>
  );
}
