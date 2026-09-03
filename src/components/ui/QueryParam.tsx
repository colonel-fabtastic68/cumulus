"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Reacts to a query parameter (e.g. ?highlight=<id> or ?new=1), then strips it
 * from the URL so a refresh does not repeat the action. Reads useSearchParams,
 * so render it inside a <Suspense> boundary. Re-runs whenever the value
 * changes, which covers in-app navigation while already on the page.
 */
export function QueryParamEffect({ param, onValue }: { param: string; onValue: (value: string) => void }) {
  const params = useSearchParams();
  const value = params.get(param);
  useEffect(() => {
    if (!value) return;
    onValue(value);
    const url = new URL(window.location.href);
    url.searchParams.delete(param);
    window.history.replaceState(null, "", url.pathname + url.search);
  }, [value, param, onValue]);
  return null;
}
