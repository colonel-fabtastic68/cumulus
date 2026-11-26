/** The nearest ancestor that scrolls, or the page itself. */
function scrollParent(el: Element): Element {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === "auto" || overflowY === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return document.scrollingElement ?? document.documentElement;
}

/** Never hold longer than this, even if `release` is not called. */
const MAX_HOLD_MS = 10_000;

/**
 * Holds an element at the same height on screen while the page re-renders around it, so a switch
 * that saves does not slide away from under the pointer. Chrome does this on its own (scroll
 * anchoring); Safari does not. Lets go as soon as the person scrolls or types, and `settleMs` after
 * the returned `release` is called.
 */
export function keepInView(el: Element | null, settleMs = 600): () => void {
  if (!el || typeof window === "undefined") return () => {};
  const scroller = scrollParent(el);
  const top = el.getBoundingClientRect().top;
  const deadline = performance.now() + MAX_HOLD_MS;
  let until = deadline;
  let stopped = false;
  const stop = () => {
    stopped = true;
    window.removeEventListener("wheel", stop);
    window.removeEventListener("touchmove", stop);
    window.removeEventListener("keydown", stop);
  };
  window.addEventListener("wheel", stop, { passive: true });
  window.addEventListener("touchmove", stop, { passive: true });
  window.addEventListener("keydown", stop);
  const hold = () => {
    if (stopped) return;
    if (el.isConnected) {
      const drift = el.getBoundingClientRect().top - top;
      if (Math.abs(drift) >= 1) scroller.scrollTop += drift;
    }
    if (performance.now() < until) requestAnimationFrame(hold);
    else stop();
  };
  requestAnimationFrame(hold);
  return () => {
    until = Math.min(deadline, performance.now() + settleMs);
  };
}
