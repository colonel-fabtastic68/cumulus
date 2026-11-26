"use client";

import { Check, Hash, Link2 } from "lucide-react";
import type { Item } from "@/lib/types";
import { Checkbox, Segmented } from "@/components/ui";
import { ChoiceCards } from "@/components/onboarding/ChoiceCards";
import { DEFAULT_ITEM_DETAILS, ITEM_DETAIL_PARTS, SYMBOLOGIES, isTwoD, type ItemDetailPart, type Symbology } from "@/lib/labels/spec";
import { isRetail, midSentence, retailReady, type CodeChoice } from "@/lib/savedCodes";
import { pluralize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CodeArt } from "./CodeArt";

/** Choosing a symbology keeps the rest of the choice sensible: bars carry the item code, not a link. */
export function withSymbology(choice: CodeChoice, symbology: Symbology): CodeChoice {
  return { ...choice, symbology, encode: isTwoD(symbology) ? choice.encode : "code" };
}

/**
 * One card per kind of code, each showing the sample item drawn that way.
 * `items` are the ones the code is for: the UPC and EAN cards say how many of them have a number to carry.
 */
export function SymbologyCards({ value, onChange, items, origin }: { value: Symbology; onChange: (s: Symbology) => void; items: Item[]; origin: string }) {
  const sample = items[0];
  return (
    <div role="radiogroup" aria-label="Kind of code" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {SYMBOLOGIES.map((s, i) => {
        const on = value === s.id;
        const ready = isRetail(s.id) ? items.filter((it) => retailReady(it, s.id)).length : items.length;
        const missing = items.length - ready;
        // A retail card shows an item that has a number, when there is one, so the card is not a stand-in.
        const shown = isRetail(s.id) ? (items.find((it) => retailReady(it, s.id)) ?? sample) : sample;
        return (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(s.id)}
            style={{ animationDelay: `${i * 55}ms` }}
            className={cn(
              "float-in relative flex flex-col items-stretch gap-3 rounded-[var(--radius)] border bg-surface p-4 text-left transition-[border-color,box-shadow,background-color] duration-150",
              on ? "border-primary shadow-[inset_0_0_0_1px_var(--primary)]" : "border-border hover:border-border-strong hover:bg-surface-hover",
            )}
          >
            <span className={cn("absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full border transition-colors", on ? "border-primary bg-primary text-text-inverse" : "border-border-strong bg-surface")} aria-hidden>
              {on && <Check className="h-3 w-3" strokeWidth={3} />}
            </span>
            <span className="flex h-[76px] items-center justify-center rounded-[var(--radius-sm)] border border-border bg-white px-3 py-2">
              {shown ? <CodeArt item={shown} code={{ symbology: s.id, encode: isTwoD(s.id) ? "link" : "code", fields: { name: false, code: false, price: false, detail: false } }} origin={origin} className={s.twoD ? "h-[60px] w-[60px]" : "h-[44px] w-full"} /> : null}
            </span>
            <span className="min-w-0">
              <span className="block text-[14px] font-medium leading-5 text-text">{s.label}</span>
              <span className="block text-[12.5px] leading-[18px] text-text-secondary">{s.hint}</span>
              {isRetail(s.id) && items.length > 0 && missing > 0 && (
                <span className="mt-1 block text-[12px] leading-[17px] text-warning">
                  {ready === 0 ? "None of these items has a barcode number for it yet." : `${pluralize(missing, "item")} of ${items.length} ${missing === 1 ? "has" : "have"} no barcode number for it.`}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Square codes only: a link that opens the item, or the item code on its own. */
export function CarriesChoice({ value, onChange, itemCode }: { value: CodeChoice["encode"]; onChange: (v: CodeChoice["encode"]) => void; itemCode: string }) {
  return (
    <ChoiceCards
      single
      options={[
        { id: "link", label: "A link to cumulusOS", hint: "A phone camera opens the item; the in-app scanner reads it too.", icon: <Link2 className="h-4 w-4" /> },
        { id: "code", label: `The ${midSentence(itemCode)} on its own`, hint: "Reads the same in any scanner or system.", icon: <Hash className="h-4 w-4" /> },
      ]}
      selected={[value]}
      onToggle={(id) => onChange(id === "link" ? "link" : "code")}
    />
  );
}

/** What is printed beside the code, and how large. */
export function CaptionOptions({ value, onChange, itemCodeShort, detailParts }: { value: CodeChoice; onChange: (next: CodeChoice) => void; itemCodeShort: string; /** Offer the choice of what the details line carries. */ detailParts: boolean }) {
  const setField = (k: keyof CodeChoice["fields"], v: boolean) => onChange({ ...value, fields: { ...value.fields, [k]: v } });
  const current = value.details ?? DEFAULT_ITEM_DETAILS;
  return (
    <div className="flex flex-col gap-2">
      <Checkbox label="Name" checked={value.fields.name} onChange={(v) => setField("name", v)} />
      <Checkbox label={itemCodeShort} checked={value.fields.code} onChange={(v) => setField("code", v)} />
      <Checkbox label="Details" help={detailParts ? undefined : "Category and bin"} checked={value.fields.detail} onChange={(v) => setField("detail", v)} />
      {detailParts && value.fields.detail && (
        <div className="ml-6 flex flex-col gap-1.5 border-l border-border pl-3">
          {ITEM_DETAIL_PARTS.map((part) => (
            <Checkbox
              key={part.id}
              label={part.label}
              help={part.hint}
              checked={current.includes(part.id)}
              // Kept in the listed order so the line reads the same whichever box was ticked first.
              onChange={(on) => onChange({ ...value, details: ITEM_DETAIL_PARTS.map((x) => x.id).filter((id): id is ItemDetailPart => (id === part.id ? on : current.includes(id))) })}
            />
          ))}
        </div>
      )}
      <Checkbox label="Price" checked={value.fields.price} onChange={(v) => setField("price", v)} />
      <div className="mt-2">
        <div className="mb-1 text-[12.5px] font-medium text-text">Text size</div>
        <Segmented<string> value={String(value.textScale ?? 1)} onChange={(v) => onChange({ ...value, textScale: Number(v) })} options={[{ value: "0.8", label: "S" }, { value: "1", label: "M" }, { value: "1.25", label: "L" }]} />
      </div>
    </div>
  );
}
