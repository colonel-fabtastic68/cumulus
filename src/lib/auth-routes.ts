/** Where the app lives once someone is signed in. */
export const APP_HOME = "/home";

/** Only accept same-origin paths as a post-sign-in destination. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/sign-") || raw.startsWith("/reset-password")) return APP_HOME;
  return raw;
}

export function signInHref(next?: string | null): string {
  const target = safeNext(next);
  return target === APP_HOME ? "/sign-in" : `/sign-in?next=${encodeURIComponent(target)}`;
}

export function signUpHref(next?: string | null): string {
  const target = safeNext(next);
  return target === APP_HOME ? "/sign-up" : `/sign-up?next=${encodeURIComponent(target)}`;
}
