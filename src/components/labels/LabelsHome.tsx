"use client";

import { Suspense, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Item } from "@/lib/types";
import { useItems } from "@/lib/store/provider";
import { useFeature } from "@/lib/useFeature";
import { CodeLibrary } from "./CodeLibrary";
import { LabelStudio } from "./LabelStudio";
import { leaveHandoff } from "./handoff";

const SHEET = "/exports/labels/sheet";
const NEW = "/exports/labels/new";
/** Parameters that describe a label sheet (a document's quantities, Strato's sheet): those links go to the sheet designer. */
const SHEET_ONLY = ["qty", "template", "symbology", "encode", "source"];

type Inbound = { to: "library" } | { to: "sheet"; query: string } | { to: "new"; pick: string[] } | { to: "select"; select: string[] };

/** Where a link into Labels & barcodes belongs now that the page opens on the saved codes. */
function inbound(params: URLSearchParams, items: Item[]): Inbound {
  const kind = params.get("kind");
  const asked = params.get("skus") || params.get("ids");
  if (SHEET_ONLY.some((k) => params.has(k)) || (kind && kind !== "item" && kind !== "assembly")) return { to: "sheet", query: params.toString() };
  if (!asked) return { to: "library" };
  const codes = new Set((params.get("skus") ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean));
  const ids = new Set((params.get("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean));
  const wanted = items.filter((i) => ids.has(i.id) || codes.has(i.sku.toUpperCase()) || (i.barcode && codes.has(i.barcode.replace(/\s+/g, "").toUpperCase())));
  if (wanted.length === 0) return { to: "library" };
  // Items that all have a code arrive ticked in the list, ready to print; otherwise the steps start with them ticked.
  return wanted.every((i) => i.savedCode) ? { to: "select", select: wanted.map((i) => i.id) } : { to: "new", pick: wanted.map((i) => i.id) };
}

function SavedHome() {
  const params = useSearchParams();
  const router = useRouter();
  const items = useItems();
  const key = params.toString();
  const target = useMemo(() => inbound(new URLSearchParams(key), items), [key, items]);

  useEffect(() => {
    if (target.to === "sheet") router.replace(`${SHEET}?${target.query}`);
    else if (target.to === "new") {
      leaveHandoff({ pick: target.pick });
      router.replace(NEW);
    } else if (target.to === "select") {
      leaveHandoff({ select: target.select });
      router.replace("/exports/labels");
    }
  }, [target, router]);

  // The list mounts once the link has been dealt with, so it picks up what was handed over.
  return target.to === "library" ? <CodeLibrary /> : null;
}

/**
 * Labels & barcodes. With saved codes on it opens on the list of codes made for each item;
 * links that ask for a label sheet go on to the sheet designer. Without the feature it is the
 * sheet designer, as before.
 */
export function LabelsHome() {
  const saved = useFeature("savedCodes");
  if (!saved) return <LabelStudio />;
  return (
    <Suspense fallback={null}>
      <SavedHome />
    </Suspense>
  );
}
