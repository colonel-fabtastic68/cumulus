"use client";

import { useState } from "react";
import type { ImportResult } from "@/lib/inventory";
import { DoneStep } from "./DoneStep";
import { MapStep } from "./MapStep";
import { guessMapping } from "./mapping";
import { ReviewStep } from "./ReviewStep";
import { Stepper } from "./Stepper";
import { UploadStep } from "./UploadStep";
import type { ColumnMapping, ParsedSource, WizardStep } from "./types";

interface WizardState {
  step: WizardStep;
  source: ParsedSource | null;
  mapping: ColumnMapping;
  result: { result: ImportResult; attempted: number } | null;
}

const INITIAL: WizardState = { step: 1, source: null, mapping: {}, result: null };

export function ImportWizard() {
  const [state, setState] = useState<WizardState>(INITIAL);
  const { step, source, mapping, result } = state;

  const goTo = (next: WizardStep) => setState((s) => ({ ...s, step: next }));

  return (
    <div>
      <Stepper current={step} onStepClick={goTo} />
      {step === 1 && (
        <UploadStep
          source={source}
          onSource={(src) => setState((s) => ({ ...s, source: src, mapping: guessMapping(src.headers).mapping, result: null }))}
          onClear={() => setState((s) => ({ ...s, source: null, mapping: {} }))}
          onContinue={() => goTo(2)}
        />
      )}
      {step === 2 && source && <MapStep source={source} mapping={mapping} onMappingChange={(m) => setState((s) => ({ ...s, mapping: m }))} onBack={() => goTo(1)} onContinue={() => goTo(3)} />}
      {step === 3 && source && <ReviewStep source={source} mapping={mapping} onBack={() => goTo(2)} onDone={(res, attempted) => setState((s) => ({ ...s, step: 4, result: { result: res, attempted } }))} />}
      {step === 4 && result && <DoneStep result={result.result} attempted={result.attempted} sourceName={source?.name ?? "your file"} onRestart={() => setState(INITIAL)} />}
    </div>
  );
}
