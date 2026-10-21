"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { AppIcon, Button } from "@/components/ui";
import { cn } from "@/lib/utils";

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Text that types itself in, with a caret while it runs. `start` chains one
 * line after another; `onDone` fires once (immediately under reduced motion).
 */
export function TypedText({ text, start = true, speed = 18, onDone, className, as: Tag = "span" }: { text: string; start?: boolean; speed?: number; onDone?: () => void; className?: string; as?: "span" | "h1" | "p" | "div" }) {
  const [shown, setShown] = useState(() => (reducedMotion() ? text.length : 0));
  const done = useRef(false);
  const notify = useRef(onDone);
  useEffect(() => {
    notify.current = onDone;
  }, [onDone]);

  useEffect(() => {
    if (!start || done.current) return;
    if (reducedMotion() || shown >= text.length) {
      done.current = true;
      notify.current?.();
      return;
    }
    let i = shown;
    const id = window.setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= text.length) {
        window.clearInterval(id);
        done.current = true;
        notify.current?.();
      }
    }, speed);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, text, speed]);

  const typing = start && shown < text.length;
  return (
    <Tag className={className} aria-label={text}>
      <span aria-hidden>{text.slice(0, shown)}</span>
      {typing && <span aria-hidden className="typed-caret" />}
    </Tag>
  );
}

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
    if (reducedMotion()) {
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
  /** 1-based position and the number of steps, for the progress pill. */
  step: number;
  total: number;
  /** A short conversational line typed before the title ("Welcome to cumulusOS, Baker!"). */
  lead?: string;
  title: string;
  subtitle?: ReactNode;
  /** Shown in the progress pill beside the step count. */
  stepName?: string;
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

/** The lead line types, then the title; the rest of the step floats in once the title has landed. */
function StepBody({ lead, title, subtitle, children, footer }: { lead?: string; title: string; subtitle?: ReactNode; children: ReactNode; footer: ReactNode }) {
  const [leadDone, setLeadDone] = useState(!lead);
  const [titleDone, setTitleDone] = useState(false);
  return (
    <>
      {lead && <TypedText as="p" text={lead} speed={16} onDone={() => setLeadDone(true)} className="mb-1.5 min-h-[20px] text-[14px] font-medium text-text-secondary" />}
      <TypedText as="h1" text={title} start={leadDone} speed={14} onDone={() => setTitleDone(true)} className="min-h-[32px] text-[24px] font-semibold leading-8 tracking-[-0.01em] text-text sm:min-h-[36px] sm:text-[28px] sm:leading-9" />
      {titleDone && (
        <>
          {subtitle && <p className="float-in mt-1.5 max-w-[640px] text-[14px] leading-6 text-text-secondary">{subtitle}</p>}
          <div className="float-in mt-6" style={{ animationDelay: "90ms" }}>
            {children}
          </div>
          {footer}
        </>
      )}
    </>
  );
}

/** The guided setup's chrome: header, a centered column, the typed heading, the step itself, its controls and the progress pill at the bottom. */
export function StepFrame({ step, total, lead, title, subtitle, stepName, companyName, children, onBack, onContinue, continueLabel = "Continue", continueDisabled, continueBusy, secondary, onSkip, help, wide, stable }: StepFrameProps) {
  const progress = Math.max(0, Math.min(1, step / total));
  const hasFooter = !!onContinue || !!onBack || !!secondary;
  const footer = hasFooter ? (
    <div className="float-in sticky bottom-0 -mx-4 mt-8 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-0" style={{ animationDelay: "180ms" }}>
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
  ) : null;

  return (
    <div className="flex min-h-full flex-col bg-bg">
      <header className="flex h-14 items-center gap-3 px-4 sm:px-6">
        <AppIcon size={26} />
        <span className="truncate text-[13.5px] font-semibold text-text">{companyName || "cumulusOS"}</span>
        <span className="ml-auto" />
        {onSkip && (
          <Button size="sm" variant="tertiary" onClick={onSkip}>
            Skip setup
          </Button>
        )}
      </header>
      <main className={cn("mx-auto w-full flex-1 px-4 pb-36 pt-4 sm:px-6 sm:pt-8", wide ? "max-w-[1080px]" : "max-w-[760px]")}>
        <FadeSwap id={step} stable={stable ? <div className="mt-6">{children}</div> : undefined}>
          <StepBody lead={lead} title={title} subtitle={subtitle} footer={footer}>
            {!stable && children}
          </StepBody>
        </FadeSwap>
      </main>

      {/* Progress: a pill at the bottom centre that fills, darkens and firms up as the steps go by. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[76px] z-[55] flex justify-center px-20 sm:bottom-5 sm:px-4">
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={step}
          aria-label={`Setup step ${step} of ${total}${stepName ? `: ${stepName}` : ""}`}
          className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-surface/95 py-2 pl-4 pr-3 shadow-[var(--shadow-flyout)] backdrop-blur transition-[transform,opacity] duration-500"
          style={{ opacity: 0.72 + 0.28 * progress, transform: `scale(${0.96 + 0.04 * progress})` }}
        >
          <span className="whitespace-nowrap text-[12.5px] font-semibold tabular text-text">
            {step} <span className="font-normal text-text-tertiary">/ {total}</span>
          </span>
          <span className="h-2 w-[120px] overflow-hidden rounded-full bg-border sm:w-[200px]">
            <span className="setup-progress block h-full rounded-full bg-primary" style={{ width: `${Math.round(progress * 100)}%`, opacity: 0.55 + 0.45 * progress }} />
          </span>
          {stepName && <span className="hidden whitespace-nowrap text-[12.5px] text-text-secondary sm:inline">{stepName}</span>}
        </div>
      </div>
      {help}
    </div>
  );
}
