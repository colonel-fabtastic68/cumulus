import type { RuntimeConfig } from "./firebase-config";

/**
 * The public demo: a visitor opens the sample workspace (Halcyon Audio) in
 * the browser with no account. A cookie switches the app layout to local
 * mode for that browser; nothing about the hosted install changes.
 */

export const DEMO_COOKIE = "cumulus_demo";
export const DEMO_WORKSPACE_ID = "demo";
/** How long a demo cookie lasts: long enough to come back to the same sample data. */
export const DEMO_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/** The runtime config the app renders with inside the demo: no Firebase, so the store is the seeded local one. */
export function demoRuntimeConfig(base: RuntimeConfig): RuntimeConfig {
  return { ...base, firebase: null, workspaceId: DEMO_WORKSPACE_ID, demo: true };
}

/** Only same-origin paths may follow leaving the demo. */
export function safeExitPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/demo")) return "/";
  return raw;
}
