"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { AppIcon, Button } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Swaps step content with a short fade: the old step fades out, then the
 * new one fades and settles in. Content for the same id re-renders in
 * place without animating. `stable` is a slot that is never snapshotted or
 * remounted across ids (the import wizard keeps its state there); it is
 * hidden while the previous step fades out.
 */
export function FadeSwap({ id, children, stable, className }: { id: string | number; children: ReactNode; stable?: ReactNode; className?: string }) {
  const [outgoing, setOutgoing] = useState<{ id: string | number; node: ReactNode } | null>(null);
  const shownId = useRef<string | number>(id);
  const lastNode = useRef<ReactNode>(children);

  useEffect(() => {
    if (shownId.current === id) return;
    const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      shownId.current = id;
      return;
    }
    setOutgoing({ id: shownId.current, node: lastNode.current });
    shownId.current = id;
    const t = setTimeout(() => setOutgoing(null), 170);
    return () => clearTimeout(t);
  }, [id]);
  useEffect(() => {
    if (!outgoing) lastNode.current = children;
  });

  return (
    <>
      {outgoing ? (
        <div key={`out-${outgoing.id}`} className={cn("step-out", className)} aria-hidden>
          {outgoing.node}
        </div>
      ) : (
        <div key={`in-${id}`} className={cn("step-in", className)}>
          {children}
        </div>
      )}
      {stable !== undefined && <div className={outgoing ? "hidden" : "step-in"}>{stable}</div>}
    </>
  );
}

export interface StepFrameProps {
  /** 1-based position and the number of steps, for the bar. */
  step: number;
  total: number;
  /** Small line above the title ("Step 2 of 7 · Your tools"). */
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  companyName?: string;
  children: ReactNode;
  /** Shown bottom-right of the step (sticky on phones). Omit when the step carries its own controls. */
  onBack?: () => void;
  onContinue?: () => void;
  continueLabel?: ReactNode;
  continueDisabled?: boolean;
  continueBusy?: boolean;
  /** Secondary action under the step: "Start from scratch", "Skip". */
  secondary?: ReactNode;
  onSkip?: () => void;
  /** Floating help control, rendered inside the frame so it sits above everything. */
  help?: ReactNode;
  /** Wider column for the import steps. */
  wide?: boolean;
  /** Keep the children mounted across steps (the import wizard carries state from map to review to done); only the heading swaps. */
  stable?: boolean;
}

/** The guided setup's chrome: progress bar, header, a centered column, the step itself and its controls. */
export function StepFrame({ step, total, eyebrow, title, subtitle, companyName, children, onBack, onContinue, continueLabel = "Continue", continueDisabled, continueBusy, secondary, onSkip, help, wide, stable }: StepFrameProps) {
  const pct = Math.max(4, Math.min(100, Math.round((step / total) * 100)));
  const hasFooter = !!onContinue || !!onBack || !!secondary;
  return (
    <div className="flex min-h-full flex-col bg-bg">
      <div className="h-[3px] w-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Setup progress">
        <div className="setup-progress h-full rounded-r-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <header className="flex h-14 items-center gap-3 px-4 sm:px-6">
        <AppIcon size={26} />
        <span className="truncate text-[13.5px] font-semibold text-text">{companyName || "cumulusOS"}</span>
        <span className="ml-auto text-[12px] tabular text-text-tertiary">
          {step} / {total}
        </span>
        {onSkip && (
          <Button size="sm" variant="tertiary" onClick={onSkip}>
            Skip setup
          </Button>
        )}
      </header>
      <main className={cn("mx-auto w-full flex-1 px-4 pb-28 pt-4 sm:px-6 sm:pt-8", wide ? "max-w-[1080px]" : "max-w-[760px]")}>
        <FadeSwap id={step} stable={stable ? <div className="mt-6">{children}</div> : undefined}>
          {eyebrow && <div className="mb-1.5 text-[12px] font-medium uppercase tracking-wide text-text-tertiary">{eyebrow}</div>}
          <h1 className="text-[24px] font-semibold leading-8 tracking-[-0.01em] text-text sm:text-[28px] sm:leading-9">{title}</h1>
          {subtitle && <p className="mt-1.5 max-w-[640px] text-[14px] leading-6 text-text-secondary">{subtitle}</p>}
          {!stable && <div className="mt-6">{children}</div>}
          {hasFooter && (
            <div className="sticky bottom-0 -mx-4 mt-8 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-0">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {onBack && (
                    <Button icon={<ArrowLeft />} onClick={onBack} disabled={continueBusy}>
                      Back
                    </Button>
                  )}
                  {secondary}
                </div>
                {onContinue && (
                  <Button variant="primary" size="lg" iconRight={<ArrowRight />} onClick={onContinue} disabled={continueDisabled} loading={continueBusy}>
                    {continueLabel}
                  </Button>
                )}
              </div>
            </div>
          )}
        </FadeSwap>
      </main>
      {help}
    </div>
  );
}
