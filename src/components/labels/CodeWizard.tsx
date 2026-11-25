"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FilterX, QrCode } from "lucide-react";
import type { Item } from "@/lib/types";
import { Badge, Banner, Button, DescriptionList, EmptyState, SearchField, Segmented, Select, Table, type Column } from "@/components/ui";
import { StepFrame } from "@/components/onboarding/StepFrame";
import { canWrite, useCurrentUser } from "@/lib/auth";
import { formatNumber, pluralize } from "@/lib/format";
import { isTwoD } from "@/lib/labels/spec";
import { DEFAULT_CODE, carriesLabel, codableItems, isRetail, midSentence, printedBeside, retailReady, saveCodes, symbologyLabel, type CodeChoice } from "@/lib/savedCodes";
import { useCollection, useItems, useSettings, useStore } from "@/lib/store/provider";
import { useFeatures } from "@/lib/useFeature";
import { useTerms } from "@/lib/useTerms";
import { matches } from "@/lib/utils";
import { LabelPreview, useOrigin } from "./CodeArt";
import { CaptionOptions, CarriesChoice, SymbologyCards, withSymbology } from "./CodeOptions";
import { clearHandoff, leaveHandoff, peekHandoff } from "./handoff";

const HOME = "/exports/labels";
const STEPS = 4;
/** Labels shown on the last step; the rest are counted. */
const REVIEW_SHOWN = 6;

type Kind = "all" | "part" | "assembly";

/**
 * New codes, one step at a time, in the guided setup's frame: which items,
 * what kind of code, what is printed beside it, then a look at the result
 * before it is saved to the list under Labels & barcodes.
 */
export function CodeWizard() {
  const router = useRouter();
  const store = useStore();
  const user = useCurrentUser();
  const writable = canWrite(user);
  const settings = useSettings();
  const terms = useTerms();
  const features = useFeatures();
  const allItems = useItems();
  const suppliers = useCollection("suppliers");
  const origin = useOrigin();

  const items = useMemo(() => codableItems(allItems), [allItems]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const supplierName = useMemo(() => {
    const names = new Map(suppliers.map((s) => [s.id, s.name]));
    return (id: string) => names.get(id);
  }, [suppliers]);

  // Items handed over from the inventory list or an item page start ticked.
  const [handed] = useState<string[] | null>(() => peekHandoff()?.pick ?? null);
  useEffect(() => {
    clearHandoff();
  }, []);

  const [step, setStep] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(handed ?? []));
  const [choice, setChoice] = useState<CodeChoice>(DEFAULT_CODE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const withCode = useMemo(() => items.filter((i) => i.savedCode).length, [items]);
  // Start on the items still waiting for a code, unless some were handed over or every item is in the same state.
  const [show, setShow] = useState<"without" | "all">(() => (!handed && items.some((i) => i.savedCode) && items.some((i) => !i.savedCode) ? "without" : "all"));

  const categories = useMemo(() => Array.from(new Set(items.map((i) => i.category).filter((c): c is string => !!c))).sort((a, b) => a.localeCompare(b)), [items]);
  const rows = useMemo(
    () => items.filter((i) => matches(q, i.sku, i.name, i.category, i.barcode) && (!category || i.category === category) && (kind === "all" || (kind === "assembly") === (i.type === "assembly")) && (show === "all" || !i.savedCode)),
    [items, q, category, kind, show],
  );
  const filtersActive = q.trim() !== "" || category !== "" || kind !== "all";
  const clearFilters = () => {
    setQ("");
    setCategory("");
    setKind("all");
  };

  // The ticked items that still exist, in part-number order: the first one is the sample the next steps draw.
  const pickedItems = useMemo(() => Array.from(picked).map((id) => byId.get(id)).filter((i): i is Item => !!i).sort((a, b) => a.sku.localeCompare(b.sku, "en", { numeric: true })), [picked, byId]);
  const sample = pickedItems[0];
  const n = pickedItems.length;
  const replacing = pickedItems.filter((i) => i.savedCode).length;
  const noNumber = isRetail(choice.symbology) ? pickedItems.filter((i) => !retailReady(i, choice.symbology)).length : 0;
  const twoD = isTwoD(choice.symbology);

  const columns = useMemo<Column<Item>[]>(
    () => [
      {
        key: "sku",
        header: terms.itemCodeShort,
        sortValue: (i) => i.sku,
        render: (i) => (
          <div className="min-w-0">
            <div className="font-mono text-[12px] font-medium text-text">{i.sku}</div>
            <div className="truncate text-[12.5px] text-text-secondary" title={i.name}>
              {i.name}
            </div>
          </div>
        ),
      },
      { key: "category", header: "Category", hideBelow: "sm", sortValue: (i) => i.category ?? "", render: (i) => i.category ?? <span className="text-text-tertiary">—</span> },
      { key: "bin", header: "Bin", hideBelow: "md", sortValue: (i) => i.location ?? "", render: (i) => (i.location ? <span className="font-mono text-[12px]">{i.location}</span> : <span className="text-text-tertiary">—</span>) },
      { key: "code", header: "Code", sortValue: (i) => (i.savedCode ? symbologyLabel(i.savedCode.symbology) : ""), render: (i) => (i.savedCode ? <Badge tone="info">{symbologyLabel(i.savedCode.symbology)}</Badge> : <span className="text-text-tertiary">None yet</span>) },
    ],
    [terms.itemCodeShort],
  );

  const cancel = () => router.push(HOME);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const ids = pickedItems.map((i) => i.id);
      const result = await saveCodes(store, user, ids, choice);
      leaveHandoff({ select: ids, made: result });
      router.push(HOME);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!features.savedCodes) router.replace(HOME);
  }, [features.savedCodes, router]);
  if (!features.savedCodes) return null;

  const frame = { total: STEPS, companyName: settings.companyName, onSkip: cancel, skipLabel: "Cancel", flowName: "New codes" };

  if (!writable)
    return (
      <StepFrame {...frame} step={1} total={1} stepName="New codes" title="Making codes needs edit access" subtitle="Your role can look at and print the codes that exist, but not make new ones. Ask the workspace owner or an admin.">
        <Button variant="primary" href={HOME}>
          Back to Labels &amp; barcodes
        </Button>
      </StepFrame>
    );

  if (items.length === 0)
    return (
      <StepFrame {...frame} step={1} total={1} stepName="New codes" title="There are no items to make codes for yet" subtitle="Add or import your items first, then come back here.">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" href="/import">
            Import items
          </Button>
          <Button href="/inventory">Open Inventory</Button>
        </div>
      </StepFrame>
    );

  if (step === 1) {
    const allShownTicked = rows.length > 0 && rows.every((i) => picked.has(i.id));
    const toolbar = (
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <SearchField value={q} onChange={setQ} placeholder={`Search ${terms.itemCodeShort}, name or barcode`} className="w-full sm:w-64" />
        {withCode > 0 && withCode < items.length && (
          <Segmented<"without" | "all">
            value={show}
            onChange={setShow}
            options={[
              { value: "without", label: "Without a code", count: items.length - withCode },
              { value: "all", label: "All items", count: items.length },
            ]}
          />
        )}
        {categories.length > 0 && <Select value={category} onChange={(e) => setCategory(e.target.value)} options={[{ value: "", label: "All categories" }, ...categories.map((c) => ({ value: c, label: c }))]} containerClassName="w-full sm:w-44" aria-label="Category" />}
        <Select
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          options={[
            { value: "all", label: "Parts and assemblies" },
            { value: "part", label: "Parts" },
            { value: "assembly", label: "Assemblies" },
          ]}
          containerClassName="w-full sm:w-48"
          aria-label="Parts or assemblies"
        />
        {filtersActive && (
          <Button variant="plain" icon={<FilterX />} onClick={clearFilters}>
            Reset filters
          </Button>
        )}
        <span className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            onClick={() =>
              setPicked((prev) => {
                const next = new Set(prev);
                for (const i of rows) {
                  if (allShownTicked) next.delete(i.id);
                  else next.add(i.id);
                }
                return next;
              })
            }
            disabled={rows.length === 0}
          >
            {allShownTicked ? `Untick these ${formatNumber(rows.length)}` : `Tick all ${formatNumber(rows.length)} shown`}
          </Button>
        </span>
      </div>
    );
    return (
      <StepFrame
        {...frame}
        step={1}
        wide
        stepName="Items"
        title="Which items get a code?"
        subtitle="Tick the items to make a barcode or QR code for. Search or filter to find them, then tick everything shown in one go."
        onContinue={() => setStep(2)}
        continueDisabled={n === 0}
        continueLabel={n === 0 ? "Continue" : `Continue with ${pluralize(n, "item")}`}
      >
        <Table
          rows={rows}
          columns={columns}
          rowKey={(i) => i.id}
          rowLabel={(i) => i.sku}
          onRowClick={(i) =>
            setPicked((prev) => {
              const next = new Set(prev);
              if (next.has(i.id)) next.delete(i.id);
              else next.add(i.id);
              return next;
            })
          }
          selectable
          selected={picked}
          onSelectedChange={setPicked}
          pageSize={8}
          dense
          defaultSort={{ key: "sku", dir: "asc" }}
          toolbar={toolbar}
          footer={`${pluralize(n, "item")} ticked · ${formatNumber(rows.length)} shown of ${formatNumber(items.length)}`}
          emptyState={
            <EmptyState
              icon={<FilterX />}
              title="No items match"
              description={show === "without" && !filtersActive ? "Every item already has a code. Show all items to remake one." : "Try a different search, or reset the filters."}
              action={
                show === "without" && !filtersActive ? (
                  <Button onClick={() => setShow("all")}>Show all items</Button>
                ) : (
                  <Button icon={<FilterX />} onClick={clearFilters}>
                    Reset filters
                  </Button>
                )
              }
            />
          }
        />
      </StepFrame>
    );
  }

  if (step === 2)
    return (
      <StepFrame
        {...frame}
        step={2}
        wide
        stepName="Kind of code"
        title="What kind of code?"
        subtitle={sample ? `Each card shows ${sample.sku} drawn that way. Square codes fit small labels and open the item from a phone camera; bars read on every handheld scanner.` : undefined}
        onBack={() => setStep(1)}
        onContinue={() => setStep(3)}
      >
        <SymbologyCards value={choice.symbology} onChange={(s) => setChoice((c) => withSymbology(c, s))} items={pickedItems} origin={origin} />
        <div className="mt-7">
          <h2 className="mb-2 text-[15px] font-semibold text-text">What it carries</h2>
          {twoD ? (
            <CarriesChoice value={choice.encode} onChange={(encode) => setChoice((c) => ({ ...c, encode }))} itemCode={terms.itemCode} />
          ) : (
            <p className="max-w-[640px] text-[13.5px] leading-6 text-text-secondary">
              {isRetail(choice.symbology)
                ? `The barcode number saved on each item. An item without one prints a Code 128 of its ${midSentence(terms.itemCode)} until a number is added on the item.`
                : `The ${midSentence(terms.itemCode)} on its own, which every scanner and system reads. A link is too long for bars; pick a square code for one.`}
            </p>
          )}
        </div>
      </StepFrame>
    );

  if (step === 3)
    return (
      <StepFrame {...frame} step={3} wide stepName="On the label" title="What is printed beside it?" subtitle="The text that goes on the label with the code. The label stock is chosen when you print." onBack={() => setStep(2)} onContinue={() => setStep(4)}>
        <div className="grid gap-5 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <div className="card p-4">
            <CaptionOptions value={choice} onChange={setChoice} itemCodeShort={terms.itemCodeShort} detailParts={features.labelFields} />
          </div>
          <div className="min-w-0">
            {sample && (
              <div className="md:sticky md:top-4">
                <LabelPreview item={sample} code={choice} origin={origin} currency={settings.currency} supplierName={supplierName} size="lg" className="max-w-[440px]" />
                <p className="mt-2 text-[12.5px] text-text-tertiary">
                  {sample.sku}
                  {n > 1 ? `, the first of ${formatNumber(n)}.` : "."}
                </p>
              </div>
            )}
          </div>
        </div>
      </StepFrame>
    );

  return (
    <StepFrame
      {...frame}
      step={4}
      wide
      stepName="Save"
      title={n === 1 ? "1 code, ready to save" : `${formatNumber(n)} codes, ready to save`}
      subtitle="They are kept under Labels & barcodes to print, export, share or change later, and a pick list prints each part's code on its line."
      onBack={() => setStep(3)}
      onContinue={() => void save()}
      continueLabel={n === 1 ? "Save the code" : `Save ${formatNumber(n)} codes`}
      continueDisabled={n === 0}
      continueBusy={saving}
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        <div className="min-w-0">
          <div className="grid gap-3 sm:grid-cols-2">
            {pickedItems.slice(0, REVIEW_SHOWN).map((i) => (
              <LabelPreview key={i.id} item={i} code={choice} origin={origin} currency={settings.currency} supplierName={supplierName} size="sm" />
            ))}
          </div>
          {n > REVIEW_SHOWN && <p className="mt-2 text-[12.5px] text-text-tertiary">And {formatNumber(n - REVIEW_SHOWN)} more, made the same way.</p>}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="card p-4">
            <DescriptionList
              rows={[
                { label: "Items", value: formatNumber(n) },
                { label: "Kind of code", value: symbologyLabel(choice.symbology) },
                { label: "Carries", value: carriesLabel(choice, terms.itemCodeShort) },
                { label: "Printed beside", value: printedBeside(choice, terms.itemCodeShort) },
              ]}
            />
          </div>
          {replacing > 0 && (
            <Banner tone="warning" title={replacing === n ? (n === 1 ? "This item already has a code" : "These items already have a code") : `${pluralize(replacing, "item")} already ${replacing === 1 ? "has" : "have"} a code`}>
              Saving replaces {replacing === 1 ? "it" : "them"} with the new one.
            </Banner>
          )}
          {noNumber > 0 && (
            <Banner tone="info" title={`${pluralize(noNumber, "item")} with no barcode number`}>
              {symbologyLabel(choice.symbology)} needs the number saved on the item. Until then {noNumber === 1 ? "it prints" : "they print"} a Code 128 of the {midSentence(terms.itemCode)}.
            </Banner>
          )}
          {error && <Banner tone="critical">{error}</Banner>}
          {n === 0 && (
            <EmptyState icon={<QrCode />} title="Nothing is ticked" description="Go back to the first step and tick the items to make codes for." action={<Button onClick={() => setStep(1)}>Choose items</Button>} />
          )}
        </div>
      </div>
    </StepFrame>
  );
}
