"use client";

import { useMemo, useState } from "react";
import { Banner, Button, Modal, Segmented, Select, useToast } from "@/components/ui";
import { useCurrentUser } from "@/lib/auth";
import { formatNumber, pluralize } from "@/lib/format";
import { SYMBOLOGIES, isTwoD, type Symbology } from "@/lib/labels/spec";
import { choiceOf, isRetail, midSentence, retailReady, symbologyLabel, updateCodes, type CodeChoice, type CodedItem } from "@/lib/savedCodes";
import { useCollection, useSettings, useStore } from "@/lib/store/provider";
import { useFeature } from "@/lib/useFeature";
import { useTerms } from "@/lib/useTerms";
import { LabelPreview, useOrigin } from "./CodeArt";
import { CaptionOptions, withSymbology } from "./CodeOptions";

/**
 * Change one code, or many at once: the kind of code, what it carries and what is printed beside it.
 * It opens on the first item's code and what is saved replaces the code on every item chosen.
 */
export function EditCodesModal({ items, onClose, onDone }: { items: CodedItem[]; onClose: () => void; onDone?: () => void }) {
  const store = useStore();
  const user = useCurrentUser();
  const toast = useToast();
  const settings = useSettings();
  const terms = useTerms();
  const detailParts = useFeature("labelFields");
  const suppliers = useCollection("suppliers");
  const origin = useOrigin();
  const first = items[0]!;
  const [choice, setChoice] = useState<CodeChoice>(() => choiceOf(first.savedCode));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supplierName = useMemo(() => {
    const names = new Map(suppliers.map((s) => [s.id, s.name]));
    return (id: string) => names.get(id);
  }, [suppliers]);
  const many = items.length > 1;
  const mixed = many && items.some((i) => i.savedCode.symbology !== first.savedCode.symbology);
  const twoD = isTwoD(choice.symbology);
  const noNumber = isRetail(choice.symbology) ? items.filter((i) => !retailReady(i, choice.symbology)).length : 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const changed = await updateCodes(store, user, items.map((i) => i.id), choice);
      toast(changed === 1 ? `Changed the code for ${first.sku}` : `Changed ${formatNumber(changed)} codes`, "success");
      onDone?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={many ? `Edit ${formatNumber(items.length)} codes` : `Edit the code for ${first.sku}`}
      subtitle={many ? undefined : first.name}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={busy}>
            {many ? `Apply to ${formatNumber(items.length)} codes` : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {many && (
          <Banner tone="info" title={`One setting for all ${formatNumber(items.length)}`}>
            {mixed ? "These codes are not all the same kind today. " : ""}What is set here replaces the code on every item chosen; it starts from {first.sku}.
          </Banner>
        )}
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,280px)]">
          <div className="flex min-w-0 flex-col gap-4">
            <div>
              <Select label="Kind of code" value={choice.symbology} onChange={(e) => setChoice((c) => withSymbology(c, e.target.value as Symbology))} options={SYMBOLOGIES.map((s) => ({ value: s.id, label: s.label }))} />
              <p className="mt-1 text-[12px] text-text-tertiary">{SYMBOLOGIES.find((s) => s.id === choice.symbology)?.hint}</p>
            </div>
            {twoD && (
              <div>
                <div className="mb-1 text-[12.5px] font-medium text-text">The code carries</div>
                <Segmented<CodeChoice["encode"]>
                  value={choice.encode}
                  onChange={(encode) => setChoice((c) => ({ ...c, encode }))}
                  options={[
                    { value: "link", label: "Link to cumulusOS" },
                    { value: "code", label: `${terms.itemCodeShort} on its own` },
                  ]}
                />
                <p className="mt-1 text-[12px] text-text-tertiary">{choice.encode === "link" ? "A phone camera opens the item; the in-app scanner reads it too." : "Reads the same in any scanner or system."}</p>
              </div>
            )}
            <div>
              <div className="mb-1.5 text-[12.5px] font-medium text-text">Printed beside the code</div>
              <CaptionOptions value={choice} onChange={setChoice} itemCodeShort={terms.itemCodeShort} detailParts={detailParts} />
            </div>
          </div>
          <div className="min-w-0">
            <LabelPreview item={first} code={choice} origin={origin} currency={settings.currency} supplierName={supplierName} />
            <p className="mt-2 text-[12px] text-text-tertiary">
              {first.sku}
              {many ? `, the first of ${formatNumber(items.length)}.` : "."}
            </p>
          </div>
        </div>
        {noNumber > 0 && (
          <Banner tone="warning" title={`${pluralize(noNumber, "item")} with no barcode number`}>
            {symbologyLabel(choice.symbology)} needs the number saved on the item. Until then {noNumber === 1 ? "it prints" : "they print"} a Code 128 of the {midSentence(terms.itemCode)}.
          </Banner>
        )}
        {error && <Banner tone="critical">{error}</Banner>}
      </div>
    </Modal>
  );
}
