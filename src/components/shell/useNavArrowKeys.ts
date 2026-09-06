"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { adjacentNavHref } from "./nav";

/** True when the key press belongs to something that uses arrow keys itself: a field, an open menu or list, a dialog. */
function isKeyboardOwner(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.closest('[role="listbox"], [role="menu"], [role="dialog"], [aria-modal="true"]') !== null;
}

/** Shift+↑ / Shift+↓ move to the previous / next page in the sidebar, in sidebar order. */
export function useNavArrowKeys(enabled: boolean) {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (isKeyboardOwner(e.target)) return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      const next = adjacentNavHref(pathname, e.key === "ArrowDown" ? 1 : -1);
      if (!next) return;
      e.preventDefault();
      router.push(next);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, pathname, router]);
}
