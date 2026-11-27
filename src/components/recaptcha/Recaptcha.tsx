"use client";

import { useEffect } from "react";
import { preloadRecaptcha, recaptchaSiteKeyInUse, setRecaptchaSiteKey } from "@/lib/recaptcha";

/**
 * Public layouts render this with the site key the server allows (null when
 * reCAPTCHA is off here), so the forms below can ask for a token.
 */
export function RecaptchaSiteKey({ siteKey }: { siteKey: string | null }) {
  // Must run before the forms below render, like Providers does with the runtime config.
  setRecaptchaSiteKey(siteKey);
  useEffect(() => {
    if (siteKey) preloadRecaptcha();
  }, [siteKey]);
  return null;
}

/**
 * The wording Google asks for when its floating badge is hidden (globals.css
 * hides it). `show` forces it on, e.g. on the sign-in pages where Firebase
 * loads reCAPTCHA itself.
 */
export function RecaptchaNotice({ show, className = "" }: { show?: boolean; className?: string }) {
  if (!show && !recaptchaSiteKeyInUse()) return null;
  return (
    <p className={`text-[11.5px] leading-4 text-text-tertiary ${className}`}>
      This site is protected by reCAPTCHA and the Google{" "}
      <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer" className="underline hover:text-text-secondary">
        Privacy Policy
      </a>{" "}
      and{" "}
      <a href="https://policies.google.com/terms" target="_blank" rel="noreferrer" className="underline hover:text-text-secondary">
        Terms of Service
      </a>{" "}
      apply.
    </p>
  );
}
