/** Timing breadcrumbs for start-up. Off unless `localStorage.setItem("cumulus:debug", "1")` in the browser console. */
export function debugLog(message: string) {
  try {
    if (typeof window === "undefined" || localStorage.getItem("cumulus:debug") !== "1") return;
    console.info(`[cumulus ${Math.round(performance.now())}ms] ${message}`);
  } catch {
    // localStorage unavailable
  }
}
