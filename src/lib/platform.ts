"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};
const isApple = () => /Macintosh|Mac OS|iPhone|iPad|iPod/i.test(navigator.userAgent ?? "");

/** "⌘" on Apple hardware, "Ctrl" elsewhere. The server renders ⌘; the client settles on the right one after hydration. */
export function useModKey(): "⌘" | "Ctrl" {
  return useSyncExternalStore(noop, () => (isApple() ? "⌘" : "Ctrl"), () => "⌘");
}
