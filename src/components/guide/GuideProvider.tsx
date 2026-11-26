"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Sparkles, X } from "lucide-react";
import type { GuideRequest, GuideResult, GuideStep } from "@/lib/guide";
import { useFeature } from "@/lib/useFeature";
import { Button, IconButton } from "@/components/ui";

declare global {
  interface Window {
    /** Development only: run a guide from the browser console, e.g. __stratoGuide({ steps: [{ target: "nav:/orders", text: "Orders live here." }] }). */
    __stratoGuide?: (req: GuideRequest) => Promise<GuideResult>;
  }
}

/**
 * Strato's on-screen guide (feature `stratoGuide`): one step at a time, the
 * control a step names (by its data-guide id, see src/lib/guide.ts) is scrolled
 * into view and ringed, with a note and Back / Next. Clicking the control
 * itself moves on too. The chat reads `summary` so Strato knows where the
 * person is in the guide.
 */

interface GuideState {
  title?: string;
  steps: GuideStep[];
  index: number;
  /** null while the control is being looked for, false when it is not on screen. */
  found: boolean | null;
}

interface GuideContextValue {
  active: GuideState | null;
  start: (req: GuideRequest) => Promise<GuideResult>;
  next: () => void;
  back: () => void;
  stop: () => void;
  /** One line for Strato's prompt: where the guide stands, or null when none is running. */
  summary: string | null;
}

const GuideContext = createContext<GuideContextValue | null>(null);

const LOOK_MS = 4000;
const POLL_MS = 120;
const MAX_STEPS = 8;
/** A control taller than this share of the window (a whole settings section) is pointed at by its top band. */
const TALL = 0.6;
const BAND = 140;
const CARD_H = 170;

function findTarget(target: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(`[data-guide="${CSS.escape(target)}"]`);
}

export function GuideProvider({ children }: { children: ReactNode }) {
  const enabled = useFeature("stratoGuide");
  const router = useRouter();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  const [active, setActive] = useState<GuideState | null>(null);
  const activeRef = useRef<GuideState | null>(null);
  // A newer step cancels the lookup of an older one.
  const run = useRef(0);

  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const show = useCallback(
    async (step: GuideStep): Promise<boolean> => {
      const id = ++run.current;
      if (step.page && pathRef.current !== step.page && !step.target.startsWith("nav:")) router.push(step.page);
      const until = Date.now() + LOOK_MS;
      while (Date.now() < until) {
        if (run.current !== id) return false;
        const el = findTarget(step.target);
        if (el) {
          const tall = el.getBoundingClientRect().height > window.innerHeight * TALL;
          el.scrollIntoView({ block: tall ? "start" : "center", inline: "nearest" });
          return true;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      return false;
    },
    [router],
  );

  const goTo = useCallback(
    async (state: GuideState, index: number): Promise<boolean> => {
      const step = state.steps[index]!;
      setActive({ ...state, index, found: null });
      const found = await show(step);
      setActive((cur) => (cur && cur.steps === state.steps && cur.index === index ? { ...cur, found } : cur));
      return found;
    },
    [show],
  );

  const start = useCallback(
    async (req: GuideRequest): Promise<GuideResult> => {
      if (!enabled) return { ok: false, summary: "On-screen guidance is off for this workspace: Settings › Labs › Strato shows you around switches it on." };
      const steps: GuideStep[] = (Array.isArray(req?.steps) ? req.steps : [])
        .filter((s) => s && typeof s.target === "string" && s.target.trim() && typeof s.text === "string" && s.text.trim())
        .slice(0, MAX_STEPS)
        .map((s) => ({ target: s.target.trim(), text: s.text.trim(), page: typeof s.page === "string" && s.page.trim() ? s.page.trim() : undefined }));
      if (steps.length === 0) return { ok: false, summary: "Nothing to show: every step needs a target id and a sentence." };
      const state: GuideState = { title: typeof req.title === "string" && req.title.trim() ? req.title.trim() : undefined, steps, index: 0, found: null };
      const found = await goTo(state, 0);
      const first = steps[0]!;
      return {
        ok: true,
        summary: `On screen now: step 1 of ${steps.length}, "${first.text}"${found ? "" : ` (${first.target} is not visible on this screen, so the note shows without a highlight)`}. The user moves on with Next or by clicking the control.`,
        missing: found ? [] : [first.target],
      };
    },
    [enabled, goTo],
  );

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    window.__stratoGuide = start;
    return () => {
      delete window.__stratoGuide;
    };
  }, [start]);

  const stop = useCallback(() => {
    run.current++;
    setActive(null);
  }, []);
  const next = useCallback(() => {
    const a = activeRef.current;
    if (!a) return;
    if (a.index + 1 >= a.steps.length) stop();
    else void goTo(a, a.index + 1);
  }, [goTo, stop]);
  const back = useCallback(() => {
    const a = activeRef.current;
    if (a && a.index > 0) void goTo(a, a.index - 1);
  }, [goTo]);

  const summary = useMemo(() => {
    if (!active) return null;
    const step = active.steps[active.index]!;
    return `${active.title ? `"${active.title}", ` : ""}step ${active.index + 1} of ${active.steps.length}: ${step.text} [target ${step.target}${step.page ? ` on ${step.page}` : ""}]${active.found === false ? "; that control was not found on the screen" : ""}`;
  }, [active]);

  const value = useMemo(() => ({ active, start, next, back, stop, summary }), [active, start, next, back, stop, summary]);
  return (
    <GuideContext.Provider value={value}>
      {children}
      {active && <GuideOverlay state={active} onNext={next} onBack={back} onStop={stop} />}
    </GuideContext.Provider>
  );
}

export function useGuide(): GuideContextValue {
  const ctx = useContext(GuideContext);
  if (!ctx) throw new Error("useGuide must be used inside <GuideProvider>");
  return ctx;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CARD_W = 300;

function GuideOverlay({ state, onNext, onBack, onStop }: { state: GuideState; onNext: () => void; onBack: () => void; onStop: () => void }) {
  const step = state.steps[state.index]!;
  const [box, setBox] = useState<Box | null>(null);

  // Follow the control while the page scrolls or re-renders.
  useEffect(() => {
    let frame = 0;
    let last = "";
    const tick = () => {
      const r = state.found ? findTarget(step.target)?.getBoundingClientRect() : undefined;
      const height = r ? (r.height > window.innerHeight * TALL ? Math.min(r.height, BAND) : r.height) : 0;
      const key = r ? [r.top, r.left, r.width, height].map(Math.round).join("/") : "";
      if (key !== last) {
        last = key;
        setBox(r ? { top: r.top, left: r.left, width: r.width, height } : null);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [step.target, state.found]);

  // Clicking the control itself counts as doing the step.
  useEffect(() => {
    if (!state.found) return;
    const onClick = (e: MouseEvent) => {
      const el = findTarget(step.target);
      if (el && e.target instanceof Node && el.contains(e.target)) setTimeout(onNext, 400);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [step.target, state.found, onNext]);

  const last = state.index === state.steps.length - 1;
  // Below the control when it fits, else above it, and always inside the window.
  let top = box ? box.top + box.height + 14 : 0;
  if (box && top + CARD_H > window.innerHeight) top = box.top - 14 - CARD_H;
  const card: CSSProperties = box
    ? { left: Math.max(12, Math.min(box.left, window.innerWidth - CARD_W - 12)), top: Math.max(12, Math.min(top, window.innerHeight - CARD_H - 12)) }
    : { left: "50%", bottom: 24, transform: "translateX(-50%)" };

  return createPortal(
    <>
      {box && <div aria-hidden className="guide-ring pointer-events-none fixed z-[140]" style={{ top: box.top - 6, left: box.left - 6, width: box.width + 12, height: box.height + 12 }} />}
      <div role="dialog" aria-label="Strato guide" className="animate-in fixed z-[141] w-[300px] max-w-[calc(100vw-24px)] rounded-[var(--radius)] border border-border bg-surface p-3 shadow-[var(--shadow-pop)]" style={card}>
        <div className="flex items-start gap-2">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-text-tertiary">
              {state.title ? `${state.title} · ` : ""}Step {state.index + 1} of {state.steps.length}
            </div>
            <p className="mt-0.5 text-[13px] text-text">{step.text}</p>
            {state.found === false && <p className="mt-1 text-[12px] text-text-tertiary">That control is not on this screen. It may be hidden at this window size, or belong to a feature that is off.</p>}
          </div>
          <IconButton variant="plain" size="sm" aria-label="Close the guide" onClick={onStop}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </div>
        <div className="mt-2 flex items-center justify-end gap-1.5">
          {state.index > 0 && (
            <Button size="sm" variant="plain" icon={<ChevronLeft />} onClick={onBack}>
              Back
            </Button>
          )}
          <Button size="sm" variant="primary" iconRight={last ? undefined : <ChevronRight />} onClick={onNext}>
            {last ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </>,
    document.body,
  );
}
