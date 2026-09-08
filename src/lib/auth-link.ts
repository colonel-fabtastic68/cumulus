/**
 * Passwordless sign-in links (Firebase "email link" auth). Invites are mailed
 * as these links: the click signs the invitee in, creating the account when the
 * address is new, and returns to the join page.
 */
import type { FirebaseApp } from "firebase/app";

/** Address a sign-in link was requested for on this device (Firebase needs it back to finish). */
export const EMAIL_FOR_SIGN_IN_KEY = "cumulus:emailForSignIn";

function absolute(path: string): string {
  return typeof window === "undefined" ? path : new URL(path, window.location.origin).toString();
}

/** Email a sign-in link that returns to `path`. The site's domain must be in Firebase's authorized domains. */
export async function sendMagicLink(app: FirebaseApp, email: string, path: string): Promise<void> {
  const { getAuth, sendSignInLinkToEmail } = await import("firebase/auth");
  await sendSignInLinkToEmail(getAuth(app), email.trim().toLowerCase(), { url: absolute(path), handleCodeInApp: true });
}

export async function isMagicLink(app: FirebaseApp, href: string): Promise<boolean> {
  const { getAuth, isSignInWithEmailLink } = await import("firebase/auth");
  return isSignInWithEmailLink(getAuth(app), href);
}

/** Complete a sign-in link for `email`. Creates the account when the address is new. */
export async function finishMagicLink(app: FirebaseApp, email: string, href: string): Promise<{ isNewUser: boolean }> {
  const { getAuth, signInWithEmailLink, getAdditionalUserInfo } = await import("firebase/auth");
  const cred = await signInWithEmailLink(getAuth(app), email.trim().toLowerCase(), href);
  return { isNewUser: getAdditionalUserInfo(cred)?.isNewUser ?? false };
}

/** Give the signed-in account a password (accounts that arrived by link have none). */
export async function setPassword(app: FirebaseApp, password: string): Promise<void> {
  const { getAuth, updatePassword } = await import("firebase/auth");
  const user = getAuth(app).currentUser;
  if (!user) throw new Error("Sign in first.");
  await updatePassword(user, password);
}

/** Drop the one-time token from the address bar once a link has been used. */
export function scrubMagicLink() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("oobCode")) return;
  for (const k of ["oobCode", "apiKey", "mode", "lang", "continueUrl"]) url.searchParams.delete(k);
  window.history.replaceState(null, "", url.toString());
}
