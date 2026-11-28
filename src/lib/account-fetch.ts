import type { FirebaseApp } from "firebase/app";
import { getFirebaseAuth } from "@/lib/store/firestore";
import { SIGN_IN_CODE_EVENT, SIGN_IN_CODE_PENDING } from "@/lib/server/signInCodeRules";

export class AccountApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Calls an account-level API route (email codes, billing, creating a workspace)
 * as the signed-in account: sends the Firebase ID token, no workspace id.
 */
export async function accountFetch<T = unknown>(app: FirebaseApp, path: string, body?: unknown, init: { method?: string } = {}): Promise<T> {
  const user = getFirebaseAuth(app).currentUser;
  if (!user) throw new AccountApiError(401, "Sign in first.");
  const token = await user.getIdToken();
  const res = await fetch(path, {
    method: init.method ?? (body === undefined ? "GET" : "POST"),
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    // The server no longer has this session down as having entered its sign-in code: ask for it again.
    if (res.status === 401 && message === SIGN_IN_CODE_PENDING) window.dispatchEvent(new Event(SIGN_IN_CODE_EVENT));
    throw new AccountApiError(res.status, message);
  }
  return data as T;
}
