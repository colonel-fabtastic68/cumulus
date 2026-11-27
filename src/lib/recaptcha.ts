"use client";

/**
 * reCAPTCHA in the browser (the `recaptcha` feature).
 *
 * Sign-in, sign-up, password reset and emailed sign-in links go from the
 * browser straight to Firebase, so Firebase checks those itself once
 * scripts/recaptcha.mjs has switched its reCAPTCHA protection on. The Firebase
 * SDK attaches the token on its own; loading the config when an auth page
 * opens lets reCAPTCHA watch the page for longer, which scores people better.
 *
 * The public forms (newsletter, demo, contact) post to our own routes, which
 * ask reCAPTCHA Enterprise for a score (src/lib/server/recaptcha.ts). The
 * server decides whether that is on and hands the site key to the page.
 */
import type { FirebaseApp } from "firebase/app";
import { debugLog } from "@/lib/debug";
import { getFirebaseAuth } from "@/lib/store/firestore";
import { accountFeatureEnabled } from "@/lib/useFeature";

let authConfig: Promise<void> | null = null;

/** Loads Firebase's reCAPTCHA config once per page load. Harmless when the project has reCAPTCHA off. */
export function prepareAuthRecaptcha(app: FirebaseApp | null): Promise<void> {
  if (!app || typeof window === "undefined" || !accountFeatureEnabled("recaptcha")) return Promise.resolve();
  authConfig ??= (async () => {
    const { initializeRecaptchaConfig } = await import("firebase/auth");
    await initializeRecaptchaConfig(getFirebaseAuth(app));
  })().catch((e) => {
    debugLog(`recaptcha: config not loaded (${e instanceof Error ? e.message : String(e)})`);
    authConfig = null;
  });
  return authConfig;
}

// ---- public forms: reCAPTCHA Enterprise, score-based, no puzzle ----

interface Grecaptcha {
  enterprise: { ready: (cb: () => void) => void; execute: (siteKey: string, opts: { action: string }) => Promise<string> };
}

let siteKey: string | null = null;
let script: Promise<Grecaptcha> | null = null;

/** Called by the public layouts with the key the server allows (null leaves the forms as they were). */
export function setRecaptchaSiteKey(key: string | null) {
  siteKey = key;
}

export function recaptchaSiteKeyInUse(): string | null {
  return siteKey;
}

function loadScript(key: string): Promise<Grecaptcha> {
  script ??= new Promise<Grecaptcha>((resolve, reject) => {
    const existing = (window as unknown as { grecaptcha?: Grecaptcha }).grecaptcha;
    if (existing?.enterprise) return existing.enterprise.ready(() => resolve(existing));
    const tag = document.createElement("script");
    tag.src = `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(key)}`;
    tag.async = true;
    tag.onload = () => {
      const g = (window as unknown as { grecaptcha?: Grecaptcha }).grecaptcha;
      if (!g?.enterprise) return reject(new Error("reCAPTCHA did not load."));
      g.enterprise.ready(() => resolve(g));
    };
    tag.onerror = () => reject(new Error("reCAPTCHA could not be reached."));
    document.head.appendChild(tag);
  }).catch((e) => {
    script = null;
    throw e;
  });
  return script;
}

/** Starts loading reCAPTCHA early, so it has seen the page by the time the form is sent. */
export function preloadRecaptcha() {
  if (siteKey && typeof window !== "undefined") void loadScript(siteKey).catch(() => {});
}

/**
 * A token for one form submission, or null when reCAPTCHA is off here. When it
 * is on but cannot load (an ad blocker), the token is null too and the server
 * says what to do.
 */
export async function recaptchaToken(action: string): Promise<string | null> {
  if (!siteKey || typeof window === "undefined") return null;
  try {
    const g = await loadScript(siteKey);
    return await g.enterprise.execute(siteKey, { action });
  } catch (e) {
    debugLog(`recaptcha: no token (${e instanceof Error ? e.message : String(e)})`);
    return null;
  }
}
