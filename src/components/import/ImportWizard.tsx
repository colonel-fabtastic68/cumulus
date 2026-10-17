"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ImportResult } from "@/lib/inventory";
import { describeAnswers } from "@/lib/onboarding";
import { useSettings } from "@/lib/store/provider";
import { DoneStep } from "./DoneStep";
import { MapStep } from "./MapStep";
import { guessMapping } from "./mapping";
import { ReviewStep } from "./ReviewStep";
import { Stepper } from "./Stepper";
import type { Overrides } from "./StratoFill";
import { UploadStep } from "./UploadStep";
import type { ColumnMapping, ParsedSource, WizardStep } from "./types";

interface WizardState {
  step: WizardStep;
  source: ParsedSource | null;
  mapping: ColumnMapping;
  /** Rows without a SKU get one (an existing item's by name, or one made from the name). */
  fillSkus: boolean;
  /** Blank cells Strato filled in on the review step, by line. */
  overrides: Overrides;
  result: { result: ImportResult; attempted: number } | null;
}

const INITIAL: WizardState = {
  step: 1,
  source: null,
  mapping: {},
  fillSkus: false,
  overrides: new Map(),
  result: null,
};

/** A sheet with no SKU column starts with SKUs filled in; the mapping step says so and can turn it off. */
function withSource(
  src: ParsedSource,
): Pick<
  WizardState,
  "source" | "mapping" | "fillSkus" | "overrides" | "result"
> {
  const guessed = guessMapping(src.headers).mapping;
  return {
    source: src,
    mapping: guessed,
    fillSkus: !Object.values(guessed).includes("sku"),
    overrides: new Map(),
    result: null,
  };
}

export interface ImportWizardProps {
  /** Start on the mapping step with this table (from the walkthrough's import hub). Change the component key to load another. */
  initialSource?: ParsedSource | null;
  /** The walkthrough draws its own progress bar. */
  hideStepper?: boolean;
  onStepChange?: (step: WizardStep) => void;
  onImported?: (result: ImportResult, attempted: number) => void;
  /** Replaces the buttons on the done step. */
  doneActions?: ReactNode;
}

export function ImportWizard({
  initialSource,
  hideStepper,
  onStepChange,
  onImported,
  doneActions,
}: ImportWizardProps = {}) {
  const settings = useSettings();
  const [state, setState] = useState<WizardState>(() =>
    initialSource
      ? { ...INITIAL, step: 2, ...withSource(initialSource) }
      : INITIAL,
  );
  const { step, source, mapping, fillSkus, overrides, result } = state;
  const hint = describeAnswers(settings.onboarding);

  const notify = useRef(onStepChange);
  useEffect(() => {
    notify.current = onStepChange;
  }, [onStepChange]);
  useEffect(() => {
    notify.current?.(step);
  }, [step]);

  const goTo = (next: WizardStep) => setState((s) => ({ ...s, step: next }));

  return (
    <div className="flex flex-col gap-4">
      {!hideStepper && <Stepper current={step} onStepClick={goTo} />}
      {/* Each step is a different component, so the keyed wrapper only adds the settle-in when the walkthrough hosts the wizard. */}
      <div key={step} className={hideStepper ? "step-in" : undefined}>
        {step === 1 && (
          <UploadStep
            source={source}
            hint={hint}
            onSource={(src) => setState((s) => ({ ...s, ...withSource(src) }))}
            onClear={() =>
              setState((s) => ({
                ...s,
                source: null,
                mapping: {},
                overrides: new Map(),
              }))
            }
            onContinue={() => goTo(2)}
          />
        )}
        {step === 2 && source && (
          <MapStep
            source={source}
            mapping={mapping}
            onMappingChange={(m) =>
              setState((s) => ({ ...s, mapping: m, overrides: new Map() }))
            }
            fillSkus={fillSkus}
            onFillSkus={(v) => setState((s) => ({ ...s, fillSkus: v }))}
            onBack={() => goTo(1)}
            onContinue={() => goTo(3)}
          />
        )}
        {step === 3 && source && (
          <ReviewStep
            source={source}
            mapping={mapping}
            fillSkus={fillSkus}
            overrides={overrides}
            onOverrides={(next) => setState((s) => ({ ...s, overrides: next }))}
            onBack={() => goTo(2)}
            onDone={(res, attempted) => {
              setState((s) => ({
                ...s,
                step: 4,
                result: { result: res, attempted },
              }));
              onImported?.(res, attempted);
            }}
          />
        )}
        {step === 4 && result && (
          <DoneStep
            result={result.result}
            attempted={result.attempted}
            sourceName={source?.name ?? "your file"}
            onRestart={() => setState(INITIAL)}
            actions={doneActions}
          />
        )}
      </div>
    </div>
  );
}
